//! Secure RetroBat game launching and process supervision.

use std::collections::HashMap;
use std::env;
use std::path::{Component, Path, PathBuf};
use std::process::ExitStatus;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::sleep;

use crate::server::AppState;

const DEFAULT_ROM_ROOT: &str = r"S:\RetroBat\roms";
const DEFAULT_BIOS_ROOT: &str = r"S:\RetroBat\bios";
const DEFAULT_LAUNCHER: &str = r"S:\RetroBat\emulationstation\emulatorLauncher.exe";
const DEFAULT_SYSTEMS_CONFIG: &str =
    r"S:\RetroBat\emulationstation\.emulationstation\es_systems.cfg";
const EARLY_EXIT_WINDOW: Duration = Duration::from_millis(700);

#[derive(Clone, Debug)]
struct SystemProfile {
    emulator: String,
    core: String,
    uses_retrobat_launcher: bool,
}

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
    rom_root: Arc<PathBuf>,
    bios_root: Arc<PathBuf>,
    launcher: Arc<PathBuf>,
    systems_config: Arc<PathBuf>,
    systems: Arc<HashMap<String, SystemProfile>>,
    state: Arc<Mutex<SupervisorState>>,
    launch_gate: Arc<Mutex<()>>,
    config_error: Arc<Option<String>>,
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

impl LaunchService {
    pub(crate) fn from_env() -> Self {
        let rom_root = env_path("CONSOLED_ROM_ROOT", DEFAULT_ROM_ROOT);
        let bios_root = env_path("CONSOLED_BIOS_ROOT", DEFAULT_BIOS_ROOT);
        let launcher = env_path("CONSOLED_RETROBAT_LAUNCHER", DEFAULT_LAUNCHER);
        let systems_config = env_path("CONSOLED_ES_SYSTEMS", DEFAULT_SYSTEMS_CONFIG);
        let parsed = std::fs::read_to_string(&systems_config)
            .map_err(|error| format!("cannot read {}: {error}", systems_config.display()))
            .and_then(|xml| parse_system_profiles(&xml));
        let (systems, config_error) = match parsed {
            Ok(systems) => (systems, None),
            Err(error) => {
                tracing::warn!(%error, "game launching is not configured");
                (HashMap::new(), Some(error))
            }
        };
        Self {
            rom_root: Arc::new(rom_root),
            bios_root: Arc::new(bios_root),
            launcher: Arc::new(launcher),
            systems_config: Arc::new(systems_config),
            systems: Arc::new(systems),
            state: Arc::new(Mutex::new(SupervisorState::default())),
            launch_gate: Arc::new(Mutex::new(())),
            config_error: Arc::new(config_error),
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
        let profile = self.systems.get(&system_id).ok_or_else(|| {
            let config_note = self
                .config_error
                .as_ref()
                .as_ref()
                .map(|error| format!(" ({error})"))
                .unwrap_or_default();
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "UNKNOWN_SYSTEM",
                format!(
                    "{system_id:?} is not a system in {}{config_note}",
                    self.systems_config.display()
                ),
            )
        })?;
        if !profile.uses_retrobat_launcher {
            return Err(ApiError::new(
                StatusCode::NOT_IMPLEMENTED,
                "UNSUPPORTED_SYSTEM",
                format!(
                    "RetroBat's configured command for {system_id:?} does not use emulatorLauncher.exe"
                ),
            ));
        }

        let rom_path = self.resolve_rom(&system_id, &request.rom_path).await?;
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

        let metadata = tokio::fs::metadata(self.launcher.as_ref())
            .await
            .map_err(|error| {
                ApiError::new(
                    StatusCode::NOT_FOUND,
                    "EMULATOR_MISSING",
                    format!(
                        "RetroBat launcher {} is unavailable: {error}",
                        self.launcher.display()
                    ),
                )
            })?;
        if !metadata.is_file() {
            return Err(ApiError::new(
                StatusCode::NOT_FOUND,
                "EMULATOR_MISSING",
                format!(
                    "RetroBat launcher is not a file: {}",
                    self.launcher.display()
                ),
            ));
        }

        let mut command = Command::new(self.launcher.as_ref());
        // Windows canonicalization commonly returns a verbatim `\\?\` path.
        // Keep it for containment checks, but RetroBat's older .NET launcher
        // calls that spelling nonexistent. The normal drive/UNC spelling is
        // the same already-validated file and remains one argv entry.
        let rom_argument = launcher_path(&rom_path);
        command
            .arg("-system")
            .arg(&system_id)
            .arg("-emulator")
            .arg(&profile.emulator)
            .arg("-core")
            .arg(&profile.core)
            .arg("-rom")
            .arg(&rom_argument);
        if let Some(home) = self.launcher.parent() {
            command.current_dir(home).env("HOME", home);
        }
        let mut child = command.spawn().map_err(|error| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                "LAUNCH_FAILED",
                format!("failed to start {}: {error}", self.launcher.display()),
            )
        })?;
        let pid = child.id().ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                "LAUNCH_FAILED",
                "RetroBat launcher started without a process id",
            )
        })?;
        tracing::info!(
            pid, system = %system_id, emulator = %profile.emulator,
            core = %profile.core, rom = %rom_path.display(), "game launch started"
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
                        "RetroBat launcher exited immediately{}",
                        format_exit_code(exit_code)
                    ),
                )
            } else {
                ApiError::new(
                    StatusCode::FAILED_DEPENDENCY,
                    "BIOS_MISSING",
                    format!(
                        "RetroBat launcher exited immediately and required BIOS files were not found under {}",
                        self.bios_root.display()
                    ),
                ).with_missing_bios(missing_bios)
            };
            return Err(error);
        }

        let running = RunningProcess {
            child,
            pid,
            system_id,
            rom_path,
            emulator: profile.emulator.clone(),
            core: profile.core.clone(),
            started_at_ms: now_ms(),
            missing_bios,
        };
        let mut state = self.state.lock().await;
        state.running = Some(running);
        Ok(snapshot(&state))
    }

    async fn resolve_rom(&self, system_id: &str, requested: &str) -> Result<PathBuf, ApiError> {
        if requested.trim().is_empty() {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "INVALID_ROM_PATH",
                "romPath cannot be empty",
            ));
        }
        let canonical_root = tokio::fs::canonicalize(self.rom_root.as_ref())
            .await
            .map_err(|error| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "ROM_ROOT_UNAVAILABLE",
                    format!("cannot open ROM root {}: {error}", self.rom_root.display()),
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
            let exists = tokio::fs::metadata(self.bios_root.join(relative))
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

fn env_path(name: &str, default: &str) -> PathBuf {
    env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(default))
}

#[cfg(windows)]
fn launcher_path(path: &Path) -> PathBuf {
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
fn launcher_path(path: &Path) -> PathBuf {
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

fn parse_system_profiles(xml: &str) -> Result<HashMap<String, SystemProfile>, String> {
    let system_re = Regex::new(r"(?s)<system>(.*?)</system>").map_err(|e| e.to_string())?;
    let name_re = Regex::new(r"(?s)<name>\s*([^<]+?)\s*</name>").map_err(|e| e.to_string())?;
    let command_re =
        Regex::new(r"(?s)<command>\s*(.*?)\s*</command>").map_err(|e| e.to_string())?;
    let emulators_re =
        Regex::new(r"(?s)<emulators>(.*?)</emulators>").map_err(|e| e.to_string())?;
    let emulator_tag_re =
        Regex::new(r#"(?s)<emulator\s+([^>]*?)(?:/?>)"#).map_err(|e| e.to_string())?;
    let core_re =
        Regex::new(r"(?s)<core([^>]*)>\s*([^<]+?)\s*</core>").map_err(|e| e.to_string())?;

    let mut systems = HashMap::new();
    for capture in system_re.captures_iter(xml) {
        let block = capture.get(1).map(|value| value.as_str()).unwrap_or("");
        let Some(name) = name_re
            .captures(block)
            .and_then(|value| value.get(1))
            .map(|value| decode_xml(value.as_str()).trim().to_ascii_lowercase())
            .filter(|value| normalize_system_id(value).is_some())
        else {
            continue;
        };
        let command = command_re
            .captures(block)
            .and_then(|value| value.get(1))
            .map(|value| decode_xml(value.as_str()))
            .unwrap_or_default();
        let emulator_block = emulators_re
            .captures(block)
            .and_then(|value| value.get(1))
            .map(|value| value.as_str())
            .unwrap_or("");
        let tags: Vec<_> = emulator_tag_re.captures_iter(emulator_block).collect();
        let selected_index = tags
            .iter()
            .position(|tag| {
                tag.get(1)
                    .map(|attrs| attribute_is_true(attrs.as_str(), "default"))
                    .unwrap_or(false)
            })
            .unwrap_or(0);
        let Some(selected) = tags.get(selected_index) else {
            continue;
        };
        let attrs = selected.get(1).map(|value| value.as_str()).unwrap_or("");
        let Some(emulator) = attribute(attrs, "name") else {
            continue;
        };

        let start = selected.get(0).map(|value| value.end()).unwrap_or(0);
        let end = tags
            .get(selected_index + 1)
            .and_then(|value| value.get(0))
            .map(|value| value.start())
            .unwrap_or(emulator_block.len());
        let cores: Vec<_> = core_re.captures_iter(&emulator_block[start..end]).collect();
        let core_index = cores
            .iter()
            .position(|core| {
                core.get(1)
                    .map(|attrs| attribute_is_true(attrs.as_str(), "default"))
                    .unwrap_or(false)
            })
            .unwrap_or(0);
        let core = cores
            .get(core_index)
            .and_then(|capture| capture.get(2))
            .map(|value| decode_xml(value.as_str()).trim().to_owned())
            .unwrap_or_default();
        systems.insert(
            name,
            SystemProfile {
                emulator,
                core,
                uses_retrobat_launcher: command.contains("emulatorLauncher.exe")
                    && command.contains("%SYSTEM%")
                    && command.contains("%ROM%"),
            },
        );
    }
    if systems.is_empty() {
        Err("RetroBat systems config contained no system profiles".to_owned())
    } else {
        Ok(systems)
    }
}

fn attribute(attrs: &str, name: &str) -> Option<String> {
    let pattern = format!(r#"\b{}\s*=\s*[\"']([^\"']+)[\"']"#, regex::escape(name));
    Regex::new(&pattern)
        .ok()?
        .captures(attrs)
        .and_then(|captures| captures.get(1))
        .map(|value| decode_xml(value.as_str()))
}

fn attribute_is_true(attrs: &str, name: &str) -> bool {
    attribute(attrs, name)
        .map(|value| value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn decode_xml(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
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

    #[cfg(windows)]
    #[test]
    fn removes_windows_verbatim_prefix_for_retrobat_only() {
        assert_eq!(
            launcher_path(Path::new(r"\\?\S:\RetroBat\roms\game.iso")),
            PathBuf::from(r"S:\RetroBat\roms\game.iso")
        );
        assert_eq!(
            launcher_path(Path::new(r"\\?\UNC\server\share\game.iso")),
            PathBuf::from(r"\\server\share\game.iso")
        );
    }

    #[test]
    fn parses_preferred_retrobat_emulator_and_core() {
        let xml = r#"
          <systemList><system><name>gamecube</name>
            <command>&quot;%HOME%\emulatorLauncher.exe&quot; -system %SYSTEM% -rom %ROM%</command>
            <emulators>
              <emulator name="libretro"><cores><core>dolphin</core></cores></emulator>
              <emulator name="dolphin" default="true"><cores>
                <core>fallback</core><core default="true">dolphin</core>
              </cores></emulator>
            </emulators>
          </system></systemList>
        "#;
        let systems = parse_system_profiles(xml).unwrap();
        let gamecube = systems.get("gamecube").unwrap();
        assert_eq!(gamecube.emulator, "dolphin");
        assert_eq!(gamecube.core, "dolphin");
        assert!(gamecube.uses_retrobat_launcher);
    }

    #[test]
    fn parses_self_closing_emulators_without_a_core() {
        let xml = r#"
          <systemList><system><name>flash</name>
            <command>emulatorLauncher.exe -system %SYSTEM% -rom %ROM%</command>
            <emulators><emulator name="ruffle"/></emulators>
          </system></systemList>
        "#;
        let systems = parse_system_profiles(xml).unwrap();
        let flash = systems.get("flash").unwrap();
        assert_eq!(flash.emulator, "ruffle");
        assert!(flash.core.is_empty());
    }
}
