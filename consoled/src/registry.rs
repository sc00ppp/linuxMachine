//! Embedded cross-platform emulator catalog.
//!
//! Generated from `shell/src/core/emulators.ts` by `tools/emit-emulators.mjs`,
//! which stays the authoring surface. Regenerate after editing that module;
//! `node tools/emit-emulators.mjs --check` fails when this file has drifted.
//!
//! The catalog is the daemon's only source of truth for *what* to run. It
//! deliberately carries no filesystem paths — `resolve.rs` turns a `binary`
//! name into an actual executable on this machine.

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

const REGISTRY_JSON: &str = include_str!("../data/emulators.json");
const SUPPORTED_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Coverage {
    Good,
    Workable,
    Poor,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum EmulatorKind {
    RetroarchCore,
    Standalone,
    /// The ROM itself is the program; there is no emulator in between.
    Direct,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub(crate) struct EmulatorLaunch {
    pub(crate) name: String,
    pub(crate) kind: EmulatorKind,
    /// Executable name only; never a path. Resolved per machine.
    pub(crate) binary: String,
    /// libretro core basename including the `_libretro` suffix.
    #[serde(default)]
    pub(crate) core: Option<String>,
    /// Ordered argv template. Never join this into a shell command string.
    pub(crate) args: Vec<String>,
    #[serde(default)]
    pub(crate) notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub(crate) struct PlatformEntry {
    pub(crate) coverage: Coverage,
    pub(crate) preferred: Option<EmulatorLaunch>,
    #[serde(default)]
    pub(crate) alternates: Vec<EmulatorLaunch>,
    #[serde(default)]
    pub(crate) notes: Option<String>,
}

impl PlatformEntry {
    /// Preferred first, then alternates — the order the resolver should try.
    pub(crate) fn candidates(&self) -> impl Iterator<Item = &EmulatorLaunch> {
        self.preferred.iter().chain(self.alternates.iter())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub(crate) struct BiosRequirement {
    pub(crate) required: bool,
    #[serde(default)]
    pub(crate) files: Vec<String>,
    #[serde(default)]
    pub(crate) notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SystemEntry {
    pub(crate) id: String,
    pub(crate) fullname: String,
    pub(crate) manufacturer: String,
    pub(crate) rom_extensions: Vec<String>,
    pub(crate) bios: BiosRequirement,
    pub(crate) platforms: Platforms,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub(crate) struct Platforms {
    pub(crate) linux: PlatformEntry,
    pub(crate) windows: PlatformEntry,
}

#[derive(Debug, Deserialize)]
pub(crate) struct Registry {
    pub(crate) version: u32,
    /// Source-library ids that coalesce into a canonical id (psx -> ps1).
    pub(crate) aliases: HashMap<String, String>,
    pub(crate) systems: HashMap<String, SystemEntry>,
}

/// Both variants are always meaningful — the catalog carries both halves — but
/// only the host's is ever constructed in a given build.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub(crate) enum Platform {
    Linux,
    Windows,
}

/// The platform this daemon is running on — emulators must be launched for the
/// host OS, never for the OS the shell happens to be rendered on.
#[cfg(windows)]
pub(crate) const HOST_PLATFORM: Platform = Platform::Windows;
#[cfg(not(windows))]
pub(crate) const HOST_PLATFORM: Platform = Platform::Linux;

/// Parsed once. A malformed catalog is a build defect in our own generated
/// file, not runtime input, so failing loudly at first use is correct.
pub(crate) fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        let parsed: Registry = serde_json::from_str(REGISTRY_JSON)
            .expect("embedded emulator registry is malformed");
        assert_eq!(
            parsed.version, SUPPORTED_VERSION,
            "emulator registry version mismatch; re-run tools/emit-emulators.mjs"
        );
        parsed
    })
}

/// Normalize a source-library id to a catalog id without inventing unknown ids.
pub(crate) fn canonical_id(system_id: &str) -> String {
    let normalized = system_id.trim().to_ascii_lowercase();
    registry()
        .aliases
        .get(&normalized)
        .cloned()
        .unwrap_or(normalized)
}

pub(crate) fn system(system_id: &str) -> Option<&'static SystemEntry> {
    registry().systems.get(&canonical_id(system_id))
}

pub(crate) fn platform_entry(
    system_id: &str,
    platform: Platform,
) -> Option<&'static PlatformEntry> {
    system(system_id).map(|entry| match platform {
        Platform::Linux => &entry.platforms.linux,
        Platform::Windows => &entry.platforms.windows,
    })
}

/// Every catalog id, sorted — used by the diagnostic endpoint.
pub(crate) fn system_ids() -> Vec<&'static str> {
    let mut ids: Vec<&str> = registry()
        .systems
        .keys()
        .map(|value| value.as_str())
        .collect();
    ids.sort_unstable();
    ids
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_registry_parses_and_is_the_expected_version() {
        assert_eq!(registry().version, SUPPORTED_VERSION);
        assert_eq!(system_ids().len(), 43);
    }

    #[test]
    fn source_library_ids_coalesce_to_canonical_ids() {
        assert_eq!(canonical_id("megadrive"), "genesis");
        assert_eq!(canonical_id("PSX"), "ps1");
        assert_eq!(canonical_id(" gbc "), "gb");
        // Unknown ids pass through rather than resolving to something wrong.
        assert_eq!(canonical_id("snes"), "snes");
        assert_eq!(canonical_id("nonesuch"), "nonesuch");
        assert!(system("nonesuch").is_none());
    }

    #[test]
    fn aliased_lookups_reach_the_same_entry_as_the_canonical_id() {
        let aliased = system("psx").expect("psx resolves");
        let canonical = system("ps1").expect("ps1 resolves");
        assert_eq!(aliased.id, canonical.id);
    }

    #[test]
    fn retroarch_entries_carry_a_core_and_a_rom_placeholder() {
        let snes = platform_entry("snes", Platform::Windows).expect("snes windows");
        let preferred = snes.preferred.as_ref().expect("snes has a preferred");
        assert_eq!(preferred.kind, EmulatorKind::RetroarchCore);
        assert_eq!(preferred.core.as_deref(), Some("snes9x_libretro"));
        assert!(preferred.args.iter().any(|arg| arg.contains("{romPath}")));
    }

    #[test]
    fn every_system_offers_at_least_one_host_candidate_or_declares_none() {
        for id in system_ids() {
            for platform in [Platform::Linux, Platform::Windows] {
                let entry = platform_entry(id, platform).expect("entry exists");
                if entry.coverage == Coverage::None {
                    continue;
                }
                assert!(
                    entry.candidates().next().is_some(),
                    "{id:?} claims coverage without an emulator"
                );
            }
        }
    }
}
