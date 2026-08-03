//! Native game launching and process supervision.
//!
//! The daemon resolves and spawns emulators itself. A client supplies only a
//! system id and a ROM path; every executable, argument and core path comes
//! from the embedded catalog (`registry.rs`) resolved against this machine
//! (`resolve.rs`). No client can influence argv.
//!
//! Note the two different system ids in play. The *source* id is what the
//! library and the on-disk ROM folders use (`megadrive`, `psx`); the *canonical*
//! id is what the catalog uses (`genesis`, `ps1`). ROM paths resolve under the
//! source id; emulator lookup canonicalizes internally.

use std::path::{Component, Path, PathBuf};
use std::process::ExitStatus;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::sleep;

use crate::resolve::{PlanError, Resolver};
use crate::server::AppState;

const EARLY_EXIT_WINDOW: Duration = Duration::from_millis(700);

#[derive(Debug)]
struct RunningProcess {
    child: Child,
    pid: u32,
    system_id: String,
    rom_path: PathBuf,
    emulator: String,
    core: String,
    started_at_ms: u128,
    missing_bios: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LastExit {
    system_id: String,
    rom_path: String,
    exit_code: Option<i32>,
    success: bool,
    exited_at_ms: u128,
}

#[derive(Default, Debug)]
struct SupervisorState {
    running: Option<RunningProcess>,
    last_exit: Option<LastExit>,
}

#[derive(Clone)]
pub(crate) struct LaunchService {
    resolver: Arc<Resolver>,
    state: Arc<Mutex<SupervisorState>>,
    launch_gate: Arc<Mutex<()>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LaunchRequest {
    system_id: String,
    rom_path: String,
    #[serde(default)]
    bios: Option<BiosRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BiosRequest {
    #[serde(default)]
    files: Vec<String>,
    #[serde(default)]
    any_of: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LaunchStatus {
    running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rom_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    emulator: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    core: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    started_at_ms: Option<u128>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    missing_bios: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_exit: Option<LastExit>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorBody {
    code: &'static str,
    message: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    missing_bios: Vec<String>,
}

pub(crate) struct ApiError {
    status: StatusCode,
    body: ErrorBody,
}

impl ApiError {
    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            body: ErrorBody {
                code,
                message: message.into(),
                missing_bios: Vec::new(),
            },
        }
    }

    fn with_missing_bios(mut self, missing_bios: Vec<String>) -> Self {
        self.body.missing_bios = missing_bios;
        self
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(self.body)).into_response()
    }
}

/// Map a resolution failure onto the HTTP surface the shell understands.
fn plan_error(error: PlanError) -> ApiError {
    let status = match error.code() {
        "UNKNOWN_SYSTEM" | "INVALID_ROM_PATH" => StatusCode::BAD_REQUEST,
        "NO_EMULATOR_FOR_SYSTEM" => StatusCode::NOT_IMPLEMENTED,
        "EMULATOR_MISSING" | "CORE_MISSING" => StatusCode::NOT_FOUND,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    ApiError::new(status, error.code(), error.message())
}

impl LaunchService {
    pub(crate) fn new(resolver: Arc<Resolver>) -> Self {
        Self {
            resolver,
            state: Arc::new(Mutex::new(SupervisorState::default())),
            launch_gate: Arc::new(Mutex::new(())),
        }
    }

    async fn launch(&self, request: LaunchRequest) -> Result<LaunchStatus, ApiError> {
        let _gate = self.launch_gate.lock().await;
        let system_id = normalize_system_id(&request.system_id).ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "INVALID_SYSTEM",
                "systemId must contain only lowercase letters, numbers, '_' or '-'",
            )
        })?;

        // Resolve the emulator before touching the filesystem for the ROM: an
        // unsupported system is a clearer answer than a missing-file error.
        let plan = self.resolver.plan(&system_id).map_err(plan_error)?;
        let rom_path = self.resolve_rom(&system_id, &request.rom_path).await?;
        let spec = plan.command(&argv_path(&rom_path)).map_err(plan_error)?;
        let missing_bios = self.check_bios(request.bios.as_ref()).await;
        {
            let mut state = self.state.lock().await;
            refresh_locked(&mut state)?;
            if let Some(running) = &state.running {
                return Err(ApiError::new(
                    StatusCode::CONFLICT,
                    "ALREADY_RUNNING",
                    format!(
                        "{} is already running for system {}",
                        running.rom_path.display(),
                        running.system_id
                    ),
                ));
            }
        }

        let mut command = Command::new(&spec.program);
        command.args(&spec.args);
        // Many emulators resolve relative config paths against their own
        // directory, so start them there rather than in the daemon's cwd.
        if let Some(working_dir) = &spec.working_dir {
            command.current_dir(working_dir);
        }
        let mut child = command.spawn().map_err(|error| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                "LAUNCH_FAILED",
                format!("failed to start {}: {error}", spec.program.display()),
            )
        })?;
        let pid = child.id().ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                "LAUNCH_FAILED",
                "the emulator started without a process id",
            )
        })?;
        let emulator = plan.emulator.name.clone();
        let core = plan.emulator.core.clone().unwrap_or_default();
        tracing::info!(
            pid, system = %system_id, emulator = %emulator, core = %core,
            program = %spec.program.display(), rom = %rom_path.display(),
            "game launch started"
        );

        sleep(EARLY_EXIT_WINDOW).await;
        if let Some(exit) = child.try_wait().map_err(supervisor_error)? {
            let exit_code = exit.code();
            self.state.lock().await.last_exit = Some(make_last_exit(&system_id, &rom_path, exit));
            let error = if missing_bios.is_empty() {
                ApiError::new(
                    StatusCode::BAD_GATEWAY,
                    "EMULATOR_EXITED",
                    format!(
                        "{emulator} exited immediately{}",
                        format_exit_code(exit_code)
                    ),
                )
            } else {
                ApiError::new(
                    StatusCode::FAILED_DEPENDENCY,
                    "BIOS_MISSING",
                    format!(
                        "{emulator} exited immediately and required BIOS files were not found under {}",
                        self.resolver.config().bios_root.display()
                    ),
                )
                .with_missing_bios(missing_bios)
            };
            return Err(error);
        }

        let running = RunningProcess {
            child,
            pid,
            system_id,
            rom_path,
            emulator,
            core,
            started_at_ms: now_ms(),
            missing_bios,
        };
        let mut state = self.state.lock().await;
        state.running = Some(running);
        Ok(snapshot(&state))
    }

    /// `system_id` here is the *source* id, matching the on-disk ROM folders.
    async fn resolve_rom(&self, system_id: &str, requested: &str) -> Result<PathBuf, ApiError> {
        if requested.trim().is_empty() {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "INVALID_ROM_PATH",
                "romPath cannot be empty",
            ));
        }
        let rom_root = &self.resolver.config().rom_root;
        let canonical_root = tokio::fs::canonicalize(rom_root).await.map_err(|error| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "ROM_ROOT_UNAVAILABLE",
                format!("cannot open ROM root {}: {error}", rom_root.display()),
            )
        })?;
        let canonical_system_root = tokio::fs::canonicalize(canonical_root.join(system_id))
            .await
            .map_err(|error| {
                ApiError::new(
                    StatusCode::NOT_FOUND,
                    "ROM_MISSING",
                    format!("ROM system directory {system_id:?} is unavailable: {error}"),
                )
            })?;
        let requested_path = Path::new(requested);
        let unresolved = if requested_path.is_absolute() {
            requested_path.to_path_buf()
        } else {
            if requested_path
                .components()
                .any(|component| !matches!(component, Component::CurDir | Component::Normal(_)))
            {
                return Err(ApiError::new(
                    StatusCode::FORBIDDEN,
                    "ROM_OUTSIDE_ROOT",
                    "relative ROM paths may contain only normal components",
                ));
            }
            canonical_system_root.join(requested_path)
        };
        let canonical_rom = tokio::fs::canonicalize(&unresolved)
            .await
            .map_err(|error| {
                ApiError::new(
                    StatusCode::NOT_FOUND,
                    "ROM_MISSING",
                    format!("ROM {requested:?} was not found: {error}"),
                )
            })?;
        if !canonical_rom.starts_with(&canonical_root)
            || !canonical_rom.starts_with(&canonical_system_root)
        {
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "ROM_OUTSIDE_ROOT",
                "the canonical ROM path is outside the configured system ROM root",
            ));
        }
        let metadata = tokio::fs::metadata(&canonical_rom).await.map_err(|error| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "ROM_MISSING",
                format!("cannot inspect ROM {}: {error}", canonical_rom.display()),
            )
        })?;
        if !metadata.is_file() {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "INVALID_ROM_PATH",
                format!("ROM path is not a file: {}", canonical_rom.display()),
            ));
        }
        Ok(canonical_rom)
    }

    async fn check_bios(&self, request: Option<&BiosRequest>) -> Vec<String> {
        let Some(request) = request else {
            return Vec::new();
        };
        let bios_root = &self.resolver.config().bios_root;
        let mut candidates = Vec::new();
        for file in request.files.iter().take(32) {
            let relative = Path::new(file);
            if file.is_empty()
                || relative
                    .components()
                    .any(|component| !matches!(component, Component::Normal(_)))
            {
                continue;
            }
            let exists = tokio::fs::metadata(bios_root.join(relative))
                .await
                .map(|metadata| metadata.is_file())
                .unwrap_or(false);
            candidates.push((file.clone(), exists));
        }
        if request.any_of && candidates.iter().any(|(_, exists)| *exists) {
            Vec::new()
        } else {
            candidates
                .into_iter()
                .filter_map(|(file, exists)| (!exists).then_some(file))
                .collect()
        }
    }

    async fn status(&self) -> Result<LaunchStatus, ApiError> {
        let mut state = self.state.lock().await;
        refresh_locked(&mut state)?;
        Ok(snapshot(&state))
    }

    async fn kill(&self) -> Result<LaunchStatus, ApiError> {
        let _gate = self.launch_gate.lock().await;
        let mut state = self.state.lock().await;
        refresh_locked(&mut state)?;
        let Some(mut running) = state.running.take() else {
            return Ok(snapshot(&state));
        };
        tracing::info!(pid = running.pid, system = %running.system_id, "stopping game");
        if let Err(error) = kill_process_tree(&mut running.child, running.pid).await {
            state.running = Some(running);
            return Err(error);
        }
        let exit = running.child.wait().await.map_err(supervisor_error)?;
        state.last_exit = Some(make_last_exit(&running.system_id, &running.rom_path, exit));
        Ok(snapshot(&state))
    }
}

pub(crate) async fn launch(
    State(state): State<AppState>,
    Json(request): Json<LaunchRequest>,
) -> Result<Json<LaunchStatus>, ApiError> {
    state.launch.launch(request).await.map(Json)
}

pub(crate) async fn status(State(state): State<AppState>) -> Result<Json<LaunchStatus>, ApiError> {
    state.launch.status().await.map(Json)
}

pub(crate) async fn kill(State(state): State<AppState>) -> Result<Json<LaunchStatus>, ApiError> {
    state.launch.kill().await.map(Json)
}

/// Windows canonicalization returns a verbatim `\\?\` path. Keep that spelling
/// for containment checks, but hand emulators the ordinary drive/UNC form —
/// plenty of them treat the verbatim prefix as a nonexistent file.
#[cfg(windows)]
fn argv_path(path: &Path) -> PathBuf {
    let text = path.as_os_str().to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path.to_path_buf()
    }
}

#[cfg(not(windows))]
fn argv_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

fn normalize_system_id(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty()
        || normalized.len() > 64
        || !normalized
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_-".contains(&byte))
    {
        None
    } else {
        Some(normalized)
    }
}

fn refresh_locked(state: &mut SupervisorState) -> Result<(), ApiError> {
    let Some(running) = state.running.as_mut() else {
        return Ok(());
    };
    let Some(exit) = running.child.try_wait().map_err(supervisor_error)? else {
        return Ok(());
    };
    tracing::info!(pid = running.pid, system = %running.system_id,
        code = ?exit.code(), "game process exited");
    state.last_exit = Some(make_last_exit(&running.system_id, &running.rom_path, exit));
    state.running = None;
    Ok(())
}

fn snapshot(state: &SupervisorState) -> LaunchStatus {
    if let Some(running) = &state.running {
        LaunchStatus {
            running: true,
            pid: Some(running.pid),
            system_id: Some(running.system_id.clone()),
            rom_path: Some(running.rom_path.to_string_lossy().into_owned()),
            emulator: Some(running.emulator.clone()),
            core: (!running.core.is_empty()).then(|| running.core.clone()),
            started_at_ms: Some(running.started_at_ms),
            missing_bios: running.missing_bios.clone(),
            last_exit: state.last_exit.clone(),
        }
    } else {
        LaunchStatus {
            running: false,
            pid: None,
            system_id: None,
            rom_path: None,
            emulator: None,
            core: None,
            started_at_ms: None,
            missing_bios: Vec::new(),
            last_exit: state.last_exit.clone(),
        }
    }
}

fn make_last_exit(system_id: &str, rom_path: &Path, exit: ExitStatus) -> LastExit {
    LastExit {
        system_id: system_id.to_owned(),
        rom_path: rom_path.to_string_lossy().into_owned(),
        exit_code: exit.code(),
        success: exit.success(),
        exited_at_ms: now_ms(),
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn format_exit_code(code: Option<i32>) -> String {
    code.map(|code| format!(" with exit code {code}"))
        .unwrap_or_default()
}

fn supervisor_error(error: std::io::Error) -> ApiError {
    ApiError::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        "SUPERVISOR_FAILED",
        format!("cannot inspect emulator process: {error}"),
    )
}

#[cfg(windows)]
async fn kill_process_tree(child: &mut Child, pid: u32) -> Result<(), ApiError> {
    let status = Command::new("taskkill.exe")
        .arg("/PID")
        .arg(pid.to_string())
        .arg("/T")
        .arg("/F")
        .status()
        .await
        .map_err(|error| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "KILL_FAILED",
                format!("could not run taskkill.exe: {error}"),
            )
        })?;
    if status.success() || child.try_wait().map_err(supervisor_error)?.is_some() {
        Ok(())
    } else {
        Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "KILL_FAILED",
            format!(
                "taskkill.exe failed for process {pid} with code {:?}",
                status.code()
            ),
        ))
    }
}

#[cfg(not(windows))]
async fn kill_process_tree(child: &mut Child, _pid: u32) -> Result<(), ApiError> {
    child.kill().await.map_err(|error| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "KILL_FAILED",
            format!("could not stop emulator process: {error}"),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_ids_are_normalized_but_not_invented() {
        assert_eq!(
            normalize_system_id(" GameCube "),
            Some("gamecube".to_owned())
        );
        assert_eq!(normalize_system_id("pc-fx"), Some("pc-fx".to_owned()));
        assert_eq!(normalize_system_id("../wii"), None);
        assert_eq!(normalize_system_id("wii/game"), None);
    }

    /// Source ids stay intact here — ROM folders on disk are named `megadrive`,
    /// not `genesis`. Only catalog lookup canonicalizes.
    #[test]
    fn normalization_does_not_coalesce_source_ids() {
        assert_eq!(
            normalize_system_id("megadrive"),
            Some("megadrive".to_owned())
        );
        assert_eq!(normalize_system_id("psx"), Some("psx".to_owned()));
    }

    #[cfg(windows)]
    #[test]
    fn removes_the_windows_verbatim_prefix_before_handing_paths_to_emulators() {
        assert_eq!(
            argv_path(Path::new(r"\\?\S:\RetroBat\roms\game.iso")),
            PathBuf::from(r"S:\RetroBat\roms\game.iso")
        );
        assert_eq!(
            argv_path(Path::new(r"\\?\UNC\server\share\game.iso")),
            PathBuf::from(r"\\server\share\game.iso")
        );
        // An ordinary path is already the spelling emulators expect.
        assert_eq!(
            argv_path(Path::new(r"S:\roms\game.iso")),
            PathBuf::from(r"S:\roms\game.iso")
        );
    }
}
