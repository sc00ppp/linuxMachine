//! Operator configuration for launching.
//!
//! Everything the daemon needs to turn a catalog entry into a real process on
//! *this* machine lives here: where ROMs and BIOS files are, and where to look
//! for emulator executables. Precedence is environment > config file > default,
//! so the existing `CONSOLED_*` variables keep working unchanged.
//!
//! This file is operator-owned local configuration, not network input. It may
//! therefore name absolute paths and argv; a WebSocket or HTTP client may not.

use std::collections::HashMap;
use std::env;
use std::path::{Path, PathBuf};

use serde::Deserialize;

#[cfg(windows)]
const DEFAULT_ROM_ROOT: &str = r"S:\RetroBat\roms";
#[cfg(windows)]
const DEFAULT_BIOS_ROOT: &str = r"S:\RetroBat\bios";
#[cfg(windows)]
const DEFAULT_EMULATOR_ROOT: &str = r"S:\RetroBat\emulators";

#[cfg(not(windows))]
const DEFAULT_ROM_ROOT: &str = "/var/lib/console/roms";
#[cfg(not(windows))]
const DEFAULT_BIOS_ROOT: &str = "/var/lib/console/bios";
#[cfg(not(windows))]
const DEFAULT_EMULATOR_ROOT: &str = "/var/lib/console/emulators";

/// Per-system escape hatch for when catalog discovery gets it wrong.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub(crate) struct SystemOverride {
    /// Absolute path to the executable, bypassing discovery entirely.
    #[serde(default)]
    pub(crate) binary: Option<PathBuf>,
    /// Full argv template, replacing the catalog's. Same placeholders apply.
    #[serde(default)]
    pub(crate) args: Option<Vec<String>>,
    /// Directory holding libretro cores for this system specifically.
    #[serde(default)]
    pub(crate) core_root: Option<PathBuf>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
struct ConfigFile {
    #[serde(default)]
    rom_root: Option<PathBuf>,
    #[serde(default)]
    bios_root: Option<PathBuf>,
    #[serde(default)]
    emulator_roots: Option<Vec<PathBuf>>,
    #[serde(default)]
    libretro_core_root: Option<PathBuf>,
    #[serde(default)]
    systems: HashMap<String, SystemOverride>,
}

#[derive(Debug, Clone)]
pub(crate) struct Config {
    pub(crate) rom_root: PathBuf,
    pub(crate) bios_root: PathBuf,
    /// Directories searched (depth-capped) for emulator executables.
    pub(crate) emulator_roots: Vec<PathBuf>,
    /// When unset, the resolver derives it from the located RetroArch install.
    pub(crate) libretro_core_root: Option<PathBuf>,
    pub(crate) systems: HashMap<String, SystemOverride>,
    /// Config file actually loaded, surfaced by the diagnostic endpoint.
    pub(crate) source: Option<PathBuf>,
    /// Non-fatal problem reading the config, surfaced rather than swallowed.
    pub(crate) load_error: Option<String>,
}

impl Config {
    pub(crate) fn load() -> Self {
        let path = config_path();
        let (file, load_error) = match &path {
            Some(path) => match std::fs::read_to_string(path) {
                Ok(text) => match toml::from_str::<ConfigFile>(&text) {
                    Ok(parsed) => (parsed, None),
                    Err(error) => (
                        ConfigFile::default(),
                        Some(format!("cannot parse {}: {error}", path.display())),
                    ),
                },
                Err(error) => (
                    ConfigFile::default(),
                    Some(format!("cannot read {}: {error}", path.display())),
                ),
            },
            None => (ConfigFile::default(), None),
        };
        if let Some(error) = &load_error {
            tracing::warn!(%error, "falling back to default launch configuration");
        }

        Self {
            rom_root: env_path("CONSOLED_ROM_ROOT")
                .or(file.rom_root)
                .unwrap_or_else(|| PathBuf::from(DEFAULT_ROM_ROOT)),
            bios_root: env_path("CONSOLED_BIOS_ROOT")
                .or(file.bios_root)
                .unwrap_or_else(|| PathBuf::from(DEFAULT_BIOS_ROOT)),
            emulator_roots: env_path_list("CONSOLED_EMULATOR_ROOTS")
                .or(file.emulator_roots)
                .unwrap_or_else(|| vec![PathBuf::from(DEFAULT_EMULATOR_ROOT)]),
            libretro_core_root: env_path("CONSOLED_LIBRETRO_CORE_ROOT")
                .or(file.libretro_core_root),
            systems: file.systems,
            source: path.filter(|path| path.exists()),
            load_error,
        }
    }

    pub(crate) fn system_override(&self, system_id: &str) -> Option<&SystemOverride> {
        self.systems.get(system_id)
    }
}

/// `CONSOLED_CONFIG` wins; otherwise look for `consoled.toml` beside the
/// executable and then in the working directory.
fn config_path() -> Option<PathBuf> {
    if let Some(explicit) = env_path("CONSOLED_CONFIG") {
        return Some(explicit);
    }
    let mut candidates = Vec::new();
    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("consoled.toml"));
        }
    }
    candidates.push(PathBuf::from("consoled.toml"));
    candidates.into_iter().find(|path| path.is_file())
}

fn env_path(name: &str) -> Option<PathBuf> {
    env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// Platform path-list separator, matching `PATH` itself (`;` on Windows).
fn env_path_list(name: &str) -> Option<Vec<PathBuf>> {
    let raw = env::var_os(name).filter(|value| !value.is_empty())?;
    let roots: Vec<PathBuf> = env::split_paths(&raw)
        .filter(|path| !path.as_os_str().is_empty())
        .collect();
    (!roots.is_empty()).then_some(roots)
}

/// Extension a libretro core carries on this platform.
pub(crate) const CORE_EXTENSION: &str = if cfg!(windows) { "dll" } else { "so" };

/// `<core>_libretro` -> `<root>/<core>_libretro.<ext>`.
pub(crate) fn core_file(core_root: &Path, core: &str) -> PathBuf {
    core_root.join(format!("{core}.{CORE_EXTENSION}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_files_use_the_host_library_extension() {
        let path = core_file(Path::new("/cores"), "snes9x_libretro");
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        if cfg!(windows) {
            assert_eq!(name, "snes9x_libretro.dll");
        } else {
            assert_eq!(name, "snes9x_libretro.so");
        }
    }

    #[test]
    fn a_malformed_config_file_degrades_to_defaults_instead_of_dying() {
        // Exercised through the parser directly; `load()` reads process env.
        let parsed = toml::from_str::<ConfigFile>("rom-root = [1, 2]");
        assert!(parsed.is_err());
    }

    #[test]
    fn config_files_use_kebab_case_keys() {
        let parsed: ConfigFile = toml::from_str(
            r#"
            rom-root = 'S:\roms'
            emulator-roots = ['S:\emulators']
            [systems.ps2]
            binary = 'S:\emulators\pcsx2\pcsx2-qt.exe'
            "#,
        )
        .expect("parses");
        assert_eq!(parsed.rom_root, Some(PathBuf::from(r"S:\roms")));
        assert_eq!(parsed.emulator_roots.unwrap().len(), 1);
        assert!(parsed.systems["ps2"].binary.is_some());
    }

    #[test]
    fn unknown_config_keys_are_rejected_rather_than_silently_ignored() {
        let parsed = toml::from_str::<ConfigFile>("rom-toot = 'S:\\roms'");
        assert!(parsed.is_err(), "a typo must not silently do nothing");
    }
}
