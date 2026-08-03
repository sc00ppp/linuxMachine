//! Turn a catalog entry into a real command on this machine.
//!
//! The catalog says *what* to run (`retroarch.exe`, `snes9x_libretro`); this
//! module says *where* it is. Discovery happens once at startup and the same
//! code path serves both `/emulators/status` and the launcher, so the
//! diagnostic genuinely predicts what a launch will do.

use std::collections::{HashMap, HashSet, VecDeque};
use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;

use crate::config::{core_file, Config, SystemOverride};
use crate::registry::{
    canonical_id, platform_entry, system, system_ids, Coverage, EmulatorKind, EmulatorLaunch,
    HOST_PLATFORM,
};

/// Emulator installs nest at most a level or two under a configured root
/// (RetroBat uses `emulators/<name>/<binary>`). The cap is not an optimization:
/// these roots sit on a multi-terabyte library drive that must never be walked
/// whole.
const MAX_SCAN_DEPTH: usize = 2;

pub(crate) const ROM_PLACEHOLDER: &str = "{romPath}";
pub(crate) const CORE_ROOT_PLACEHOLDER: &str = "{libretroCorePath}";

/// Extensions we can start *and supervise*. A shortcut or script hands off to
/// another process and the child we spawned exits immediately, which would make
/// the console lose the running game.
#[cfg(windows)]
const DIRECT_ROM_EXTENSIONS: &[&str] = &["exe"];
#[cfg(not(windows))]
const DIRECT_ROM_EXTENSIONS: &[&str] = &["exe", "x86_64", "appimage"];

/// Filesystem name comparison: case-insensitive where the filesystem is.
fn name_key(name: &str) -> String {
    if cfg!(windows) {
        name.to_ascii_lowercase()
    } else {
        name.to_owned()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Program {
    /// A resolved emulator executable.
    Emulator(PathBuf),
    /// The ROM itself, for `EmulatorKind::Direct`.
    Rom,
}

#[derive(Debug, Clone)]
pub(crate) struct SystemPlan {
    pub(crate) emulator: &'static EmulatorLaunch,
    pub(crate) program: Program,
    pub(crate) core_path: Option<PathBuf>,
    core_root: Option<PathBuf>,
    args: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedCommand {
    pub(crate) program: PathBuf,
    pub(crate) args: Vec<OsString>,
    /// Many emulators resolve relative config paths against their own folder.
    pub(crate) working_dir: Option<PathBuf>,
}

impl SystemPlan {
    /// Final argv for a specific ROM. The ROM is already canonicalized and
    /// containment-checked by the caller; this only fills placeholders.
    pub(crate) fn command(&self, rom: &Path) -> Result<ResolvedCommand, PlanError> {
        let program = match &self.program {
            Program::Emulator(path) => path.clone(),
            Program::Rom => {
                let extension = rom
                    .extension()
                    .map(|value| value.to_string_lossy().to_ascii_lowercase())
                    .unwrap_or_default();
                if !DIRECT_ROM_EXTENSIONS.contains(&extension.as_str()) {
                    return Err(PlanError::RomNotExecutable { rom: rom.to_path_buf() });
                }
                rom.to_path_buf()
            }
        };
        let args = self
            .args
            .iter()
            .map(|template| substitute(template, rom, self.core_root.as_deref()))
            .collect();
        Ok(ResolvedCommand {
            working_dir: program.parent().map(Path::to_path_buf),
            program,
            args,
        })
    }
}

/// Replace `{romPath}` / `{libretroCorePath}` without ever round-tripping a
/// path through `String` — Windows paths are not guaranteed to be UTF-8.
fn substitute(template: &str, rom: &Path, core_root: Option<&Path>) -> OsString {
    let mut out = OsString::new();
    let mut rest = template;
    loop {
        let rom_at = rest.find(ROM_PLACEHOLDER);
        let core_at = rest.find(CORE_ROOT_PLACEHOLDER);
        let (at, len, value) = match (rom_at, core_at) {
            (Some(r), Some(c)) if r <= c => (r, ROM_PLACEHOLDER.len(), Some(rom)),
            (Some(_), Some(c)) => (c, CORE_ROOT_PLACEHOLDER.len(), core_root),
            (Some(r), None) => (r, ROM_PLACEHOLDER.len(), Some(rom)),
            (None, Some(c)) => (c, CORE_ROOT_PLACEHOLDER.len(), core_root),
            (None, None) => {
                out.push(rest);
                return out;
            }
        };
        out.push(&rest[..at]);
        if let Some(value) = value {
            out.push(value.as_os_str());
        }
        rest = &rest[at + len..];
    }
}

#[derive(Debug, Clone)]
pub(crate) enum PlanError {
    UnknownSystem { system_id: String },
    NoNativeSupport { system_id: String, notes: Option<String> },
    EmulatorMissing { system_id: String, tried: Vec<String> },
    CoreMissing { core: String, expected: PathBuf },
    CoreRootUnknown { core: String },
    RomNotExecutable { rom: PathBuf },
}

impl PlanError {
    /// Stable codes consumed by `shell/src/core/launch.ts`.
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::UnknownSystem { .. } => "UNKNOWN_SYSTEM",
            Self::NoNativeSupport { .. } => "NO_EMULATOR_FOR_SYSTEM",
            Self::EmulatorMissing { .. } => "EMULATOR_MISSING",
            Self::CoreMissing { .. } | Self::CoreRootUnknown { .. } => "CORE_MISSING",
            Self::RomNotExecutable { .. } => "INVALID_ROM_PATH",
        }
    }

    pub(crate) fn message(&self) -> String {
        match self {
            Self::UnknownSystem { system_id } => {
                format!("{system_id:?} is not a system in the emulator catalog")
            }
            Self::NoNativeSupport { system_id, notes } => match notes {
                Some(notes) => format!("{system_id:?} has no supported emulator: {notes}"),
                None => format!("{system_id:?} has no supported emulator on this platform"),
            },
            Self::EmulatorMissing { system_id, tried } => format!(
                "no emulator for {system_id:?} could be found on this machine (looked for {})",
                tried.join(", ")
            ),
            Self::CoreMissing { core, expected } => {
                format!("libretro core {core:?} is not installed at {}", expected.display())
            }
            Self::CoreRootUnknown { core } => format!(
                "libretro core {core:?} is required but no core directory is configured; \
                 set libretro-core-root in consoled.toml"
            ),
            Self::RomNotExecutable { rom } => format!(
                "{} cannot be launched directly; only {} files can be supervised",
                rom.display(),
                DIRECT_ROM_EXTENSIONS.join("/")
            ),
        }
    }
}

pub(crate) struct Resolver {
    config: Arc<Config>,
    /// name_key(binary) -> absolute path.
    binaries: HashMap<String, PathBuf>,
    libretro_core_root: Option<PathBuf>,
}

impl Resolver {
    pub(crate) fn new(config: Arc<Config>) -> Self {
        let wanted = wanted_binaries();
        let mut binaries = scan_roots(&config.emulator_roots, &wanted);
        // Anything the configured roots did not provide may still be on PATH.
        for name in &wanted {
            if !binaries.contains_key(name) {
                if let Some(found) = from_path_env(name) {
                    binaries.insert(name.clone(), found);
                }
            }
        }

        let libretro_core_root = config.libretro_core_root.clone().or_else(|| {
            ["retroarch.exe", "retroarch"]
                .iter()
                .find_map(|name| binaries.get(&name_key(name)))
                .and_then(|path| path.parent())
                .map(|dir| dir.join("cores"))
        });

        tracing::info!(
            resolved = binaries.len(),
            wanted = wanted.len(),
            core_root = ?libretro_core_root,
            "emulator discovery finished"
        );

        Self { config, binaries, libretro_core_root }
    }

    pub(crate) fn config(&self) -> &Config {
        &self.config
    }

    /// Choose the first catalog candidate that is actually installed.
    pub(crate) fn plan(&self, system_id: &str) -> Result<SystemPlan, PlanError> {
        let canonical = canonical_id(system_id);
        let entry = platform_entry(&canonical, HOST_PLATFORM)
            .ok_or_else(|| PlanError::UnknownSystem { system_id: canonical.clone() })?;
        let overrides = self.config.system_override(&canonical);

        let no_support = || PlanError::NoNativeSupport {
            system_id: canonical.clone(),
            notes: entry.notes.clone(),
        };
        if entry.coverage == Coverage::None {
            return Err(no_support());
        }

        // An explicit binary override names one specific executable, so it
        // applies to the preferred candidate only — silently reusing it for a
        // different emulator further down the list would launch the wrong thing.
        if let Some(binary) = overrides.and_then(|over| over.binary.as_ref()) {
            let candidate = entry.candidates().next().ok_or_else(no_support)?;
            if !binary.is_file() {
                return Err(PlanError::EmulatorMissing {
                    system_id: canonical.clone(),
                    tried: vec![binary.display().to_string()],
                });
            }
            return self.build(candidate, overrides, Program::Emulator(binary.clone()));
        }

        let mut tried = Vec::new();
        let mut core_failure = None;
        for candidate in entry.candidates() {
            let program = match candidate.kind {
                EmulatorKind::Direct => Program::Rom,
                _ => match self.binaries.get(&name_key(&candidate.binary)) {
                    Some(path) => Program::Emulator(path.clone()),
                    None => {
                        // Several cores share one executable; naming it once
                        // keeps the error readable.
                        if !tried.contains(&candidate.binary) {
                            tried.push(candidate.binary.clone());
                        }
                        continue;
                    }
                },
            };
            match self.build(candidate, overrides, program) {
                Ok(plan) => return Ok(plan),
                Err(error @ (PlanError::CoreMissing { .. } | PlanError::CoreRootUnknown { .. })) => {
                    // Keep looking: another core for the same system may exist.
                    if core_failure.is_none() {
                        core_failure = Some(error);
                    }
                }
                Err(other) => return Err(other),
            }
        }

        // A located emulator missing one core is more actionable than a list of
        // executables that were never found at all.
        if let Some(failure) = core_failure {
            return Err(failure);
        }
        if tried.is_empty() {
            return Err(no_support());
        }
        Err(PlanError::EmulatorMissing { system_id: canonical, tried })
    }

    fn build(
        &self,
        candidate: &'static EmulatorLaunch,
        overrides: Option<&SystemOverride>,
        program: Program,
    ) -> Result<SystemPlan, PlanError> {
        let core_root = overrides
            .and_then(|over| over.core_root.clone())
            .or_else(|| self.libretro_core_root.clone());
        let args = overrides
            .and_then(|over| over.args.clone())
            .unwrap_or_else(|| candidate.args.clone());

        let core_path = if candidate.kind == EmulatorKind::RetroarchCore {
            let core = candidate.core.as_deref().unwrap_or_default();
            let root = core_root
                .clone()
                .ok_or_else(|| PlanError::CoreRootUnknown { core: core.to_owned() })?;
            let file = core_file(&root, core);
            if !file.is_file() {
                return Err(PlanError::CoreMissing { core: core.to_owned(), expected: file });
            }
            Some(file)
        } else {
            None
        };

        Ok(SystemPlan {
            emulator: candidate,
            program,
            core_path,
            core_root,
            args,
        })
    }

    pub(crate) fn report(&self) -> ResolverReport {
        let systems = system_ids()
            .into_iter()
            .map(|id| {
                let entry = system(id).expect("catalog id resolves");
                let platform = platform_entry(id, HOST_PLATFORM).expect("platform entry");
                match self.plan(id) {
                    Ok(plan) => SystemDiagnostic {
                        id,
                        fullname: &entry.fullname,
                        coverage: platform.coverage,
                        ready: true,
                        emulator: Some(plan.emulator.name.clone()),
                        program: match &plan.program {
                            Program::Emulator(path) => Some(path.display().to_string()),
                            Program::Rom => Some("<the title itself>".to_owned()),
                        },
                        core: plan.emulator.core.clone(),
                        core_path: plan.core_path.map(|path| path.display().to_string()),
                        problem: None,
                        problem_code: None,
                    },
                    Err(error) => SystemDiagnostic {
                        id,
                        fullname: &entry.fullname,
                        coverage: platform.coverage,
                        ready: false,
                        emulator: None,
                        program: None,
                        core: None,
                        core_path: None,
                        problem: Some(error.message()),
                        problem_code: Some(error.code()),
                    },
                }
            })
            .collect::<Vec<_>>();

        let ready = systems.iter().filter(|system| system.ready).count();
        ResolverReport {
            platform: if cfg!(windows) { "windows" } else { "linux" },
            config: ConfigReport {
                source: self.config.source.as_ref().map(|p| p.display().to_string()),
                load_error: self.config.load_error.clone(),
                rom_root: self.config.rom_root.display().to_string(),
                bios_root: self.config.bios_root.display().to_string(),
                emulator_roots: self
                    .config
                    .emulator_roots
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect(),
                libretro_core_root: self
                    .libretro_core_root
                    .as_ref()
                    .map(|path| path.display().to_string()),
            },
            summary: Summary { total: systems.len(), ready, unavailable: systems.len() - ready },
            systems,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SystemDiagnostic {
    id: &'static str,
    fullname: &'static str,
    coverage: Coverage,
    ready: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    emulator: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    program: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    core: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    core_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    problem: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    problem_code: Option<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigReport {
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    load_error: Option<String>,
    rom_root: String,
    bios_root: String,
    emulator_roots: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    libretro_core_root: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Summary {
    total: usize,
    ready: usize,
    unavailable: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResolverReport {
    platform: &'static str,
    config: ConfigReport,
    summary: Summary,
    systems: Vec<SystemDiagnostic>,
}

/// Every executable name the host platform could need, `direct` entries aside
/// (their "binary" is the ROM placeholder, not a program to find).
fn wanted_binaries() -> HashSet<String> {
    let mut wanted = HashSet::new();
    for id in system_ids() {
        let Some(entry) = platform_entry(id, HOST_PLATFORM) else {
            continue;
        };
        for candidate in entry.candidates() {
            if candidate.kind != EmulatorKind::Direct {
                wanted.insert(name_key(&candidate.binary));
            }
        }
    }
    wanted
}

/// Breadth-first so a shallower install wins over a nested duplicate, and roots
/// earlier in the list win over later ones.
fn scan_roots(roots: &[PathBuf], wanted: &HashSet<String>) -> HashMap<String, PathBuf> {
    let mut found = HashMap::new();
    for root in roots {
        let mut queue = VecDeque::from([(root.clone(), 0usize)]);
        while let Some((dir, depth)) = queue.pop_front() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let Ok(kind) = entry.file_type() else {
                    continue;
                };
                if kind.is_dir() {
                    if depth < MAX_SCAN_DEPTH {
                        queue.push_back((entry.path(), depth + 1));
                    }
                    continue;
                }
                let key = name_key(&entry.file_name().to_string_lossy());
                if wanted.contains(&key) {
                    found.entry(key).or_insert_with(|| entry.path());
                }
            }
        }
    }
    found
}

/// PATH lookup, honoring PATHEXT for names given without an extension.
fn from_path_env(binary: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    for dir in env::split_paths(&path_var) {
        let direct = dir.join(binary);
        if direct.is_file() {
            return Some(direct);
        }
        if cfg!(windows) && Path::new(binary).extension().is_none() {
            let pathext = env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_owned());
            for extension in pathext.split(';').filter(|value| !value.is_empty()) {
                let candidate = dir.join(format!("{binary}{}", extension.to_ascii_lowercase()));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn substitution_fills_both_placeholders_in_place() {
        let rom = Path::new("/roms/snes/game.sfc");
        let core_root = Path::new("/emulators/retroarch/cores");
        assert_eq!(
            substitute(ROM_PLACEHOLDER, rom, Some(core_root)),
            OsString::from("/roms/snes/game.sfc")
        );
        // The catalog embeds the placeholder inside a longer argument.
        assert_eq!(
            substitute("{libretroCorePath}/snes9x_libretro.so", rom, Some(core_root)),
            OsString::from("/emulators/retroarch/cores/snes9x_libretro.so")
        );
        assert_eq!(substitute("--fullscreen", rom, None), OsString::from("--fullscreen"));
        assert_eq!(substitute("", rom, None), OsString::from(""));
    }

    #[test]
    fn substitution_handles_repeats_and_adjacent_placeholders() {
        let rom = Path::new("/r.sfc");
        let core = Path::new("/c");
        assert_eq!(
            substitute("{romPath}:{romPath}", rom, Some(core)),
            OsString::from("/r.sfc:/r.sfc")
        );
        assert_eq!(
            substitute("{libretroCorePath}{romPath}", rom, Some(core)),
            OsString::from("/c/r.sfc")
        );
    }

    /// The template's core filename and `config::core_file` are written
    /// independently; this guards them against drifting apart.
    #[test]
    fn catalog_core_arguments_agree_with_the_core_file_helper() {
        let entry = platform_entry("snes", HOST_PLATFORM).expect("snes");
        let preferred = entry.preferred.as_ref().expect("preferred");
        let core = preferred.core.as_deref().expect("core");
        let root = Path::new("/cores");
        let expected = core_file(root, core);
        let rendered: Vec<OsString> = preferred
            .args
            .iter()
            .map(|arg| substitute(arg, Path::new("/rom"), Some(root)))
            .collect();
        assert!(
            rendered.iter().any(|arg| Path::new(arg) == expected),
            "argv {rendered:?} never names {}",
            expected.display()
        );
    }

    #[test]
    fn scanning_is_depth_capped_and_prefers_shallow_matches() {
        let temp = std::env::temp_dir().join("consoled-scan-test");
        let _ = std::fs::remove_dir_all(&temp);
        let shallow = temp.join("retroarch");
        let too_deep = temp.join("a").join("b").join("c");
        std::fs::create_dir_all(&shallow).expect("shallow dir");
        std::fs::create_dir_all(&too_deep).expect("deep dir");
        std::fs::write(shallow.join("retroarch.exe"), b"").expect("shallow exe");
        std::fs::write(too_deep.join("buried.exe"), b"").expect("deep exe");

        let wanted = HashSet::from([name_key("retroarch.exe"), name_key("buried.exe")]);
        let found = scan_roots(&[temp.clone()], &wanted);

        assert_eq!(found.get(&name_key("retroarch.exe")), Some(&shallow.join("retroarch.exe")));
        assert!(
            !found.contains_key(&name_key("buried.exe")),
            "depth {MAX_SCAN_DEPTH} must not reach a third level of directories"
        );
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn direct_entries_reject_files_that_cannot_be_supervised() {
        let entry = platform_entry("windows", HOST_PLATFORM).expect("windows system");
        let candidate = entry.preferred.as_ref().expect("preferred");
        assert_eq!(candidate.kind, EmulatorKind::Direct);
        let plan = SystemPlan {
            emulator: candidate,
            program: Program::Rom,
            core_path: None,
            core_root: None,
            args: candidate.args.clone(),
        };
        assert!(plan.command(Path::new("/games/Game.exe")).is_ok());
        let rejected = plan.command(Path::new("/games/Game.lnk"));
        assert!(matches!(rejected, Err(PlanError::RomNotExecutable { .. })));
    }

    #[test]
    fn systems_without_a_native_emulator_report_why() {
        let config = Arc::new(Config {
            rom_root: PathBuf::from("/roms"),
            bios_root: PathBuf::from("/bios"),
            emulator_roots: vec![PathBuf::from("/nonexistent-emulator-root")],
            libretro_core_root: None,
            systems: HashMap::new(),
            source: None,
            load_error: None,
        });
        let resolver = Resolver::new(config);
        let error = resolver.plan("ports").expect_err("ports has no native emulator");
        assert_eq!(error.code(), "NO_EMULATOR_FOR_SYSTEM");
        assert!(error.message().contains("descriptor"), "{}", error.message());

        let unknown = resolver.plan("nonesuch").expect_err("unknown system");
        assert_eq!(unknown.code(), "UNKNOWN_SYSTEM");
    }

    /// SNES lists five RetroArch cores behind one executable, so a naive error
    /// names `retroarch` five times. Asserted across the whole catalog so the
    /// test stays meaningful whatever happens to be installed on this machine.
    #[test]
    fn missing_emulator_errors_name_each_executable_once() {
        let config = Arc::new(Config {
            rom_root: PathBuf::from("/roms"),
            bios_root: PathBuf::from("/bios"),
            emulator_roots: vec![PathBuf::from("/nonexistent-emulator-root")],
            libretro_core_root: None,
            systems: HashMap::new(),
            source: None,
            load_error: None,
        });
        let resolver = Resolver::new(config);
        for id in system_ids() {
            if let Err(PlanError::EmulatorMissing { tried, .. }) = resolver.plan(id) {
                let mut unique = tried.clone();
                unique.sort();
                unique.dedup();
                assert_eq!(unique.len(), tried.len(), "{id} repeats a binary: {tried:?}");
            }
        }
    }
}
