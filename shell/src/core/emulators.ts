/**
 * Cross-platform launch metadata for every system in the imported game library.
 *
 * This module intentionally does not resolve source-library paths. `romPath`
 * must be replaced with a path visible on the console (for example, a local
 * cache path or a mounted SMB/NFS path) before a process supervisor launches
 * anything. Arguments are arrays so that the future supervisor does not need
 * to parse or quote a shell command string.
 *
 * `binary` is the executable name expected on PATH. AppImage and Flatpak
 * installs should expose a stable wrapper with that name; package-specific
 * filesystem paths do not belong in this registry.
 */

export const ROM_PATH_PLACEHOLDER = '{romPath}' as const;
export const LIBRETRO_CORE_PATH_PLACEHOLDER = '{libretroCorePath}' as const;

export type Platform = 'linux' | 'windows';
export type CoverageStatus = 'good' | 'workable' | 'poor' | 'none';
export type EmulatorKind = 'retroarch-core' | 'standalone';

export interface EmulatorLaunch {
  /** Human-readable emulator name, including the core/fork where useful. */
  readonly name: string;
  /** RetroArch cores and standalone programs have different launch contracts. */
  readonly kind: EmulatorKind;
  /** Executable name as installed/exposed on the selected platform. */
  readonly binary: string;
  /** Actual libretro core basename, including the `_libretro` suffix. */
  readonly core?: string;
  /** Ordered argv template; never join this into a shell command. */
  readonly argsTemplate: readonly string[];
  readonly notes?: string;
}

export interface EmulatorBiosRequirement {
  /** True when the preferred launch path cannot reliably boot without it. */
  readonly required: boolean;
  /** Exact filenames where the emulator requires them; may list optional files. */
  readonly files: readonly string[];
  readonly notes?: string;
}

interface LinuxSystemEntry {
  /** Canonical shell id after RetroBat id coalescing. */
  readonly id: string;
  readonly status: CoverageStatus;
  /** Preferred emulator first, followed by realistic alternates. */
  readonly emulators: readonly EmulatorLaunch[];
  readonly bios: EmulatorBiosRequirement;
  readonly notes?: string;
}

export interface PlatformEmulatorEntry {
  readonly coverage: CoverageStatus;
  readonly preferred: EmulatorLaunch | null;
  readonly alternates: readonly EmulatorLaunch[];
  readonly notes?: string;
}

export interface EmulatorEntry {
  /** Canonical shell id. */
  readonly id: string;
  /** RetroBat source ids represented by this entry. */
  readonly retroBatIds: readonly string[];
  readonly fullname: string;
  readonly manufacturer: string;
  readonly release: number | null;
  /** Exact lower-case extension tokens transcribed from es_systems.cfg. */
  readonly romExtensions: readonly string[];
  readonly bios: EmulatorBiosRequirement;
  readonly platforms: Readonly<Record<Platform, PlatformEmulatorEntry>>;
}

export interface EmulatorLookup {
  readonly entry: EmulatorEntry;
  readonly platform: Platform;
  readonly config: PlatformEmulatorEntry;
}

function retroarch(
  name: string,
  core: string,
  notes?: string,
): EmulatorLaunch {
  const coreName = `${core}_libretro`;
  return {
    name,
    kind: 'retroarch-core',
    binary: 'retroarch',
    core: coreName,
    argsTemplate: [
      '--fullscreen',
      '-L',
      `${LIBRETRO_CORE_PATH_PLACEHOLDER}/${coreName}.so`,
      ROM_PATH_PLACEHOLDER,
    ],
    ...(notes ? { notes } : {}),
  };
}

function standalone(
  name: string,
  binary: string,
  argsTemplate: readonly string[],
  notes?: string,
): EmulatorLaunch {
  return {
    name,
    kind: 'standalone',
    binary,
    argsTemplate,
    ...(notes ? { notes } : {}),
  };
}

/**
 * Linux half of the registry. It has the 42 canonical library systems plus
 * PC-FX, whose BIOS requirement was explicitly requested for future imports.
 */
const LINUX_EMULATORS: Readonly<Record<string, LinuxSystemEntry>> = {
  '3ds': {
    id: '3ds',
    status: 'workable',
    emulators: [
      standalone('Citra', 'citra-qt', [ROM_PATH_PLACEHOLDER]),
      retroarch(
        'RetroArch / Citra',
        'citra',
        'The libretro core requires decrypted ROMs.',
      ),
    ],
    bios: {
      required: false,
      files: ['aes_keys.txt (only for encrypted dumps)', 'dumped 3DS system archives (game-dependent)'],
      notes:
        'No BIOS is required for decrypted games. Some titles need Mii or other system archives dumped from a 3DS.',
    },
    notes:
      'Citra is discontinued, so the Linux image must pin and expose a known native/AppImage build as citra-qt. Dual-screen/touch layout still needs a couch-friendly profile.',
  },

  atari2600: {
    id: 'atari2600',
    status: 'good',
    emulators: [
      retroarch('RetroArch / Stella', 'stella'),
      retroarch('RetroArch / Stella 2014', 'stella2014'),
      standalone('Stella', 'stella', ['-fullscreen', '1', ROM_PATH_PLACEHOLDER]),
    ],
    bios: { required: false, files: [] },
  },

  atari5200: {
    id: 'atari5200',
    status: 'good',
    emulators: [
      retroarch('RetroArch / a5200', 'a5200'),
      retroarch('RetroArch / Atari800', 'atari800'),
    ],
    bios: {
      required: true,
      files: ['5200.rom'],
      notes:
        'Both listed cores can use the optional 5200.rom; keep the correctly named dump for highest compatibility.',
    },
  },

  atari7800: {
    id: 'atari7800',
    status: 'good',
    emulators: [retroarch('RetroArch / ProSystem', 'prosystem')],
    bios: {
      required: false,
      files: ['7800 BIOS (U).rom'],
      notes: 'The ProSystem core treats the Atari 7800 BIOS as optional.',
    },
  },

  atarist: {
    id: 'atarist',
    status: 'workable',
    emulators: [
      standalone('Hatari', 'hatari', ['--fullscreen', ROM_PATH_PLACEHOLDER]),
      retroarch('RetroArch / Hatari', 'hatari'),
    ],
    bios: {
      required: true,
      files: ['tos.img'],
      notes:
        'TOS 1.02 is a broadly compatible ST default, but some ST/STE/Falcon software needs a different dumped TOS revision.',
    },
    notes:
      'Computer-style keyboard/mouse input and multi-disk swapping make this less appliance-like than cartridge consoles.',
  },

  channelf: {
    id: 'channelf',
    status: 'good',
    emulators: [
      retroarch('RetroArch / FreeChaF', 'freechaf'),
      standalone('MAME', 'mame', ['channelf', '-cart', ROM_PATH_PLACEHOLDER]),
    ],
    bios: {
      required: true,
      files: ['sl31253.bin', 'sl31254.bin', 'sl90025.bin'],
      notes:
        'FreeChaF requires the first two chips; sl90025.bin is the Channel F System II replacement for sl31253.bin.',
    },
  },

  colecovision: {
    id: 'colecovision',
    status: 'good',
    emulators: [
      retroarch('RetroArch / Gearcoleco', 'gearcoleco'),
      retroarch(
        'RetroArch / blueMSX',
        'bluemsx',
        'Requires the blueMSX Machines and Databases directories, not only a single BIOS file.',
      ),
    ],
    bios: {
      required: true,
      files: ['colecovision.rom'],
      notes: 'Gearcoleco also accepts the fallback name coleco.rom.',
    },
  },

  dreamcast: {
    id: 'dreamcast',
    status: 'good',
    emulators: [
      standalone('Flycast', 'flycast', [ROM_PATH_PLACEHOLDER]),
      retroarch('RetroArch / Flycast', 'flycast'),
    ],
    bios: {
      required: true,
      files: ['dc/dc_boot.bin', 'dc/dc_flash.bin'],
      notes:
        'Flycast can HLE-boot some retail games, but the catalog treats both matching dumps as required for dependable coverage. NAOMI/Atomiswave BIOS archives are separate.',
    },
  },

  gamecube: {
    id: 'gamecube',
    status: 'good',
    emulators: [
      standalone('Dolphin', 'dolphin-emu', [
        '--batch',
        '--fullscreen',
        `--exec=${ROM_PATH_PLACEHOLDER}`,
      ]),
      retroarch(
        'RetroArch / Dolphin',
        'dolphin',
        'The standalone build is preferred because the libretro port trails Dolphin features and configuration.',
      ),
    ],
    bios: { required: false, files: [] },
  },

  gamegear: {
    id: 'gamegear',
    status: 'good',
    emulators: [
      retroarch('RetroArch / Genesis Plus GX', 'genesis_plus_gx'),
      retroarch('RetroArch / Gearsystem', 'gearsystem'),
    ],
    bios: {
      required: false,
      files: ['bios.gg'],
      notes: 'The Game Gear startup BIOS is optional in Genesis Plus GX.',
    },
  },

  gb: {
    id: 'gb',
    status: 'good',
    emulators: [
      retroarch('RetroArch / SameBoy', 'sameboy'),
      retroarch('RetroArch / Gambatte', 'gambatte'),
    ],
    bios: {
      required: false,
      files: ['dmg_boot.bin', 'cgb_boot.bin'],
      notes:
        'SameBoy boot ROMs are optional. Gambatte uses the alternate optional names gb_bios.bin and gbc_bios.bin.',
    },
    notes: 'Both gb and gbc source ids intentionally resolve to this entry.',
  },

  gba: {
    id: 'gba',
    status: 'good',
    emulators: [
      retroarch('RetroArch / mGBA', 'mgba'),
      standalone('mGBA', 'mgba-qt', [ROM_PATH_PLACEHOLDER]),
    ],
    bios: {
      required: false,
      files: ['gba_bios.bin'],
      notes: 'mGBA has a high-level BIOS; the original GBA BIOS dump is optional.',
    },
  },

  jaguar: {
    id: 'jaguar',
    status: 'poor',
    emulators: [
      retroarch(
        'RetroArch / Virtual Jaguar',
        'virtualjaguar',
        'Compatibility is substantially below the Windows-only BigPEmu option.',
      ),
    ],
    bios: { required: false, files: [] },
    notes: 'Per the supplied platform constraint, BigPEmu is not claimed as a Linux option.',
  },

  jaguarcd: {
    id: 'jaguarcd',
    status: 'none',
    emulators: [],
    bios: { required: false, files: [] },
    notes:
      'The reliable RetroBat choice is BigPEmu, which is treated as Windows-only for this project; no Linux option is asserted.',
  },

  lynx: {
    id: 'lynx',
    status: 'good',
    emulators: [
      retroarch('RetroArch / Handy', 'handy'),
      retroarch('RetroArch / Beetle Lynx', 'mednafen_lynx'),
      retroarch('RetroArch / GearLynx', 'gearlynx'),
    ],
    bios: {
      required: true,
      files: ['lynxboot.img'],
      notes: 'Use the exact, case-sensitive filename expected by the cores.',
    },
  },

  mastersystem: {
    id: 'mastersystem',
    status: 'good',
    emulators: [
      retroarch('RetroArch / Genesis Plus GX', 'genesis_plus_gx'),
      retroarch('RetroArch / Gearsystem', 'gearsystem'),
    ],
    bios: {
      required: false,
      files: ['bios_U.sms', 'bios_E.sms', 'bios_J.sms'],
      notes: 'Region startup BIOS files are optional in Genesis Plus GX.',
    },
  },

  genesis: {
    id: 'genesis',
    status: 'good',
    emulators: [
      retroarch('RetroArch / Genesis Plus GX', 'genesis_plus_gx'),
      standalone('BlastEm', 'blastem', [ROM_PATH_PLACEHOLDER]),
    ],
    bios: {
      required: false,
      files: ['bios_MD.bin'],
      notes: 'The Mega Drive startup ROM is optional.',
    },
    notes: 'The RetroBat megadrive id resolves to this canonical genesis entry.',
  },

  n64: {
    id: 'n64',
    status: 'good',
    emulators: [
      retroarch('RetroArch / Mupen64Plus-Next', 'mupen64plus_next'),
      standalone('Mupen64Plus', 'mupen64plus', ['--fullscreen', ROM_PATH_PLACEHOLDER]),
    ],
    bios: { required: false, files: [] },
  },

  n64dd: {
    id: 'n64dd',
    status: 'workable',
    emulators: [retroarch('RetroArch / Mupen64Plus-Next', 'mupen64plus_next')],
    bios: {
      required: true,
      files: ['Mupen64plus/IPL.n64'],
      notes: 'The 64DD IPL must live under the RetroArch system directory with this exact subpath.',
    },
    notes:
      'Mupen64Plus-Next accepts .ndd images, but disk/cartridge pairing and the small 64DD library still need per-title validation.',
  },

  nds: {
    id: 'nds',
    status: 'good',
    emulators: [
      standalone('melonDS', 'melonDS', [ROM_PATH_PLACEHOLDER]),
      retroarch('RetroArch / melonDS DS', 'melondsds'),
      retroarch('RetroArch / DeSmuME', 'desmume'),
    ],
    bios: {
      required: false,
      files: [
        'bios7.bin',
        'bios9.bin',
        'firmware.bin',
        'dsi_bios7.bin (DSi mode)',
        'dsi_bios9.bin (DSi mode)',
        'dsi_firmware.bin (DSi mode)',
        'dsi_nand.bin (full DSi mode)',
      ],
      notes:
        'Current melonDS can direct-boot ordinary decrypted DS games with built-in replacements. Real dumps are required for full firmware boot, encrypted content, and complete DSi behavior.',
    },
    notes: 'A TV-friendly two-screen layout and a pointer binding must be configured before treating this as appliance-ready.',
  },

  neogeo: {
    id: 'neogeo',
    status: 'good',
    emulators: [
      retroarch('RetroArch / FinalBurn Neo', 'fbneo'),
      retroarch(
        'RetroArch / Geolith',
        'geolith',
        'Geolith expects NeoSD .neo images rather than ordinary FBNeo split/merged ZIP sets.',
      ),
      retroarch('RetroArch / MAME', 'mame'),
    ],
    bios: {
      required: true,
      files: ['neogeo.zip'],
      notes:
        'The BIOS archive must match the installed FBNeo ROM-set version. Keep the archive intact; the configured BIOS directory may be system/fbneo or beside the game archive.',
    },
  },

  nes: {
    id: 'nes',
    status: 'good',
    emulators: [
      retroarch('RetroArch / Mesen', 'mesen'),
      retroarch('RetroArch / Nestopia UE', 'nestopia'),
    ],
    bios: {
      required: false,
      files: ['disksys.rom (Famicom Disk System only)'],
      notes: 'Cartridge games need no BIOS; FDS images need disksys.rom.',
    },
  },

  pcengine: {
    id: 'pcengine',
    status: 'good',
    emulators: [
      retroarch('RetroArch / Beetle PCE', 'mednafen_pce'),
      retroarch('RetroArch / Beetle PCE Fast', 'mednafen_pce_fast'),
      standalone('Mednafen', 'mednafen', [ROM_PATH_PLACEHOLDER]),
    ],
    bios: {
      required: false,
      files: ['syscard3.pce (PC Engine CD only)'],
      notes: 'HuCard games need no BIOS. CD/Super CD content requires the appropriate system card; syscard3.pce covers most of it.',
    },
  },

  pcfx: {
    id: 'pcfx',
    status: 'good',
    emulators: [
      retroarch('RetroArch / Beetle PC-FX', 'mednafen_pcfx'),
      standalone('Mednafen (PC-FX)', 'mednafen', ['-force_module', 'pcfx', ROM_PATH_PLACEHOLDER]),
    ],
    bios: {
      required: true,
      files: ['pcfx.rom'],
      notes: 'Beetle PC-FX and Mednafen require this exact BIOS filename.',
    },
    notes: 'Included for BIOS completeness even though the current library has no PC-FX games.',
  },

  pokemini: {
    id: 'pokemini',
    status: 'good',
    emulators: [retroarch('RetroArch / PokeMini', 'pokemini')],
    bios: { required: false, files: [] },
  },

  ports: {
    id: 'ports',
    status: 'none',
    emulators: [],
    bios: { required: false, files: [] },
    notes:
      'There is no generic Ports emulator. RetroBat .bat/.lnk wrappers are Windows-specific; each title needs a native Linux executable or a newly authored, audited per-title launcher before it can be registered.',
  },

  ps2: {
    id: 'ps2',
    status: 'good',
    emulators: [
      standalone('PCSX2', 'pcsx2-qt', [
        '-batch',
        '-fullscreen',
        '--',
        ROM_PATH_PLACEHOLDER,
      ]),
    ],
    bios: {
      required: true,
      files: ['scph39001.bin', 'SCPH-70012_BIOS_V12_USA_200.bin', 'ps2-0230a-20080220.bin'],
      notes:
        'Only one valid, legally dumped regional BIOS is required. These are conventional examples; PCSX2 detects BIOS contents and does not impose one universal filename. Keep its associated .nvm/.mec files.',
    },
  },

  ps3: {
    id: 'ps3',
    status: 'workable',
    emulators: [
      standalone('RPCS3', 'rpcs3', [
        '--no-gui',
        '--fullscreen',
        ROM_PATH_PLACEHOLDER,
      ]),
    ],
    bios: {
      required: true,
      files: ['PS3UPDAT.PUP'],
      notes: 'Install official PS3 system firmware into RPCS3 once; the PUP is not passed on each game launch.',
    },
    notes:
      'RPCS3 compatibility is title- and CPU-dependent. The GTX 970 is usable with Vulkan, but the unknown host CPU prevents calling PS3 coverage good.',
  },

  psp: {
    id: 'psp',
    status: 'good',
    emulators: [
      standalone('PPSSPP', 'PPSSPPSDL', ['--fullscreen', ROM_PATH_PLACEHOLDER]),
      retroarch(
        'RetroArch / PPSSPP',
        'ppsspp',
        'The core also needs its bundled assets, lang and flash0 directories under the RetroArch system/PPSSPP directory.',
      ),
    ],
    bios: {
      required: false,
      files: [],
      notes: 'PPSSPP does not use a PSP BIOS. Its data assets are distributed with the emulator and are not console firmware.',
    },
  },

  ps1: {
    id: 'ps1',
    status: 'good',
    emulators: [
      standalone('DuckStation', 'duckstation-qt', [
        '-batch',
        '-fullscreen',
        '--',
        ROM_PATH_PLACEHOLDER,
      ], 'Linux packages/AppImages expose different outer filenames; the console image must provide a stable duckstation-qt wrapper.'),
      retroarch('RetroArch / Beetle PSX HW', 'beetle_psx_hw'),
      retroarch('RetroArch / SwanStation', 'swanstation'),
    ],
    bios: {
      required: true,
      files: ['scph5500.bin', 'scph5501.bin', 'scph5502.bin'],
      notes:
        'These are the exact case-sensitive JP/US/EU filenames required by Beetle PSX HW. DuckStation accepts additional verified regional dumps.',
    },
    notes:
      'RetroBat calls this preference mednafen_psx_hw; this catalog exposes the requested actual core name beetle_psx_hw_libretro.',
  },

  saturn: {
    id: 'saturn',
    status: 'good',
    emulators: [
      retroarch('RetroArch / Beetle Saturn', 'mednafen_saturn'),
      standalone('Mednafen', 'mednafen', [ROM_PATH_PLACEHOLDER]),
      retroarch(
        'RetroArch / Kronos',
        'kronos',
        'Hardware rendering and upscaling are useful, but compatibility is below Beetle Saturn.',
      ),
    ],
    bios: {
      required: true,
      files: ['sega_101.bin', 'mpr-17933.bin'],
      notes: 'Beetle Saturn requires the exact JP and US/EU BIOS filenames shown here.',
    },
  },

  sega32x: {
    id: 'sega32x',
    status: 'workable',
    emulators: [retroarch('RetroArch / PicoDrive', 'picodrive')],
    bios: { required: false, files: [] },
    notes:
      'Genesis Plus GX does not emulate 32X. PicoDrive is the established open-source core, but it is less accurate than the best Genesis-only emulators.',
  },

  segacd: {
    id: 'segacd',
    status: 'good',
    emulators: [
      retroarch('RetroArch / Genesis Plus GX', 'genesis_plus_gx'),
      retroarch('RetroArch / PicoDrive', 'picodrive'),
    ],
    bios: {
      required: true,
      files: ['bios_CD_U.bin', 'bios_CD_E.bin', 'bios_CD_J.bin'],
      notes: 'Use the exact case-sensitive US, Europe and Japan filenames expected by both listed cores.',
    },
  },

  snes: {
    id: 'snes',
    status: 'good',
    emulators: [
      retroarch('RetroArch / Snes9x', 'snes9x'),
      retroarch('RetroArch / bsnes', 'bsnes'),
    ],
    bios: {
      required: false,
      files: ['BS-X.bin (Satellaview only)', 'STBIOS.bin (Sufami Turbo only)'],
      notes: 'Ordinary SNES/SFC cartridges need no BIOS.',
    },
  },

  supergrafx: {
    id: 'supergrafx',
    status: 'good',
    emulators: [
      retroarch('RetroArch / Beetle SuperGrafx', 'mednafen_supergrafx'),
      retroarch('RetroArch / Beetle PCE', 'mednafen_pce'),
    ],
    bios: {
      required: false,
      files: ['syscard3.pce (CD content only)'],
      notes: 'SuperGrafx HuCards need no BIOS; CD content uses the PC Engine system card.',
    },
  },

  switch: {
    id: 'switch',
    status: 'poor',
    emulators: [
      standalone(
        'Ryujinx',
        'Ryujinx',
        [ROM_PATH_PLACEHOLDER],
        'Expose the validated Linux build through a stable Ryujinx wrapper; the actual package may be an AppImage or Flatpak.',
      ),
    ],
    bios: {
      required: true,
      files: ['prod.keys', 'title.keys (content-dependent)', 'dumped Nintendo Switch system firmware'],
      notes:
        'Keys and firmware must be dumped from hardware the owner controls. They are not redistributable BIOS downloads.',
    },
    notes:
      'The GTX 970 has only 4 GB VRAM, compatibility is title-specific, and emulator availability/upstream status is volatile. Validate and pin the chosen Linux build before promoting this above poor.',
  },

  triforce: {
    id: 'triforce',
    status: 'none',
    emulators: [],
    bios: {
      required: false,
      files: [],
      notes: 'No BIOS contract is asserted until the dedicated Dolphin-Triforce build is validated.',
    },
    notes:
      'The media PC uses a dedicated Dolphin-Triforce build. No known, packaged Linux binary is asserted until the console image validates one.',
  },

  virtualboy: {
    id: 'virtualboy',
    status: 'good',
    emulators: [
      retroarch('RetroArch / Beetle VB', 'mednafen_vb'),
      standalone('Mednafen', 'mednafen', [ROM_PATH_PLACEHOLDER]),
    ],
    bios: { required: false, files: [] },
  },

  wii: {
    id: 'wii',
    status: 'good',
    emulators: [
      standalone('Dolphin', 'dolphin-emu', [
        '--batch',
        '--fullscreen',
        `--exec=${ROM_PATH_PLACEHOLDER}`,
      ]),
      retroarch(
        'RetroArch / Dolphin',
        'dolphin',
        'The standalone build is preferred for Wii Remote, motion and per-game controller configuration.',
      ),
    ],
    bios: { required: false, files: [] },
    notes: 'Games that require pointing, motion, Balance Board or other attachments need per-title input profiles.',
  },

  wiiu: {
    id: 'wiiu',
    status: 'workable',
    emulators: [
      standalone('Cemu', 'cemu', ['-f', '-g', ROM_PATH_PLACEHOLDER]),
    ],
    bios: {
      required: false,
      files: ['keys.txt (encrypted content only)'],
      notes: 'Cemu needs no console BIOS. Encrypted disc/install formats need legally dumped title keys; decrypted/loadiine content does not.',
    },
    notes:
      'Cemu is native on Linux and runs most Wii U games, but the Linux port and GamePad second-screen/control experience still require per-title validation.',
  },

  windows: {
    id: 'windows',
    status: 'poor',
    emulators: [
      standalone(
        'Wine (per-title prefix)',
        'wine',
        [ROM_PATH_PLACEHOLDER],
        'The resolved path must be a Windows executable, not the source RetroBat .lnk/.bat wrapper.',
      ),
      standalone(
        'UMU/Proton (per-title prefix)',
        'umu-run',
        [ROM_PATH_PLACEHOLDER],
        'Requires a configured Proton build, prefix and per-title environment; there is no safe universal configuration.',
      ),
    ],
    bios: { required: false, files: [] },
    notes:
      'Windows games are not one emulated platform. Every title needs a Linux-visible executable, prefix, runtime/dependency setup and controller profile; original Windows drive letters and shortcuts cannot be reused.',
  },

  xbox: {
    id: 'xbox',
    status: 'workable',
    emulators: [
      standalone('xemu', 'xemu', [
        '-full-screen',
        '-dvd_path',
        ROM_PATH_PLACEHOLDER,
      ]),
    ],
    bios: {
      required: true,
      files: [
        'mcpx_1.0.bin',
        'Complex_4627v1.03.bin (recommended compatible flash ROM; filename is configurable)',
        'xbox_hdd.qcow2',
      ],
      notes:
        'xemu is a low-level emulator and needs an MCPX boot ROM, compatible flash ROM and initialized HDD image. Dump copyrighted firmware from owned hardware.',
    },
    notes: 'Compatibility is substantial but not complete, so keep per-title overrides and a compatibility check in the future launcher UI.',
  },

  xbox360: {
    id: 'xbox360',
    status: 'none',
    emulators: [],
    bios: { required: false, files: [] },
    notes:
      'Xenia is a Windows application with no native Linux build. It can sometimes start through Wine/Vulkan, but that path is too fragile and hardware-dependent to register as a viable living-room launcher on this GTX 970 target.',
  },
};

function windowsRetroarch(
  name: string,
  core: string,
  notes?: string,
): EmulatorLaunch {
  const coreName = `${core}_libretro`;
  return {
    name,
    kind: 'retroarch-core',
    binary: 'retroarch.exe',
    core: coreName,
    argsTemplate: [
      '--fullscreen',
      '-L',
      `${LIBRETRO_CORE_PATH_PLACEHOLDER}\\${coreName}.dll`,
      ROM_PATH_PLACEHOLDER,
    ],
    ...(notes ? { notes } : {}),
  };
}

function windowsStandalone(
  name: string,
  binary: string,
  argsTemplate: readonly string[] = [ROM_PATH_PLACEHOLDER],
  notes?: string,
): EmulatorLaunch {
  return standalone(name, binary, argsTemplate, notes);
}

function windowsConfig(
  coverage: CoverageStatus,
  emulators: readonly EmulatorLaunch[],
  notes?: string,
): PlatformEmulatorEntry {
  return {
    coverage,
    preferred: emulators[0] ?? null,
    alternates: emulators.slice(1),
    ...(notes ? { notes } : {}),
  };
}

/**
 * Windows preference order follows the supplied RetroBat es_systems.cfg.
 * A core in that XML becomes its actual `<core>_libretro.dll` basename here.
 */
const WINDOWS_EMULATORS: Readonly<Record<string, PlatformEmulatorEntry>> = {
  '3ds': windowsConfig('good', [
    windowsRetroarch('RetroArch / Citra', 'citra'),
    windowsStandalone('Citra', 'citra-qt.exe'),
    windowsStandalone('Citra Canary', 'citra-qt.exe', [ROM_PATH_PLACEHOLDER], 'Resolved from RetroBat\'s separate citra-canary directory.'),
  ], 'These are the installed RetroBat choices. Both Citra tracks are discontinued, so keep the known-working media-PC build rather than silently upgrading it.'),

  atari2600: windowsConfig('good', [
    windowsRetroarch('RetroArch / Stella', 'stella'),
    windowsRetroarch('RetroArch / Stella 2014', 'stella2014'),
    windowsStandalone('Stella', 'Stella.exe'),
    windowsStandalone('BizHawk (A26)', 'EmuHawk.exe'),
  ]),

  atari5200: windowsConfig('good', [
    windowsRetroarch('RetroArch / a5200', 'a5200'),
    windowsRetroarch('RetroArch / Atari800', 'atari800'),
    windowsRetroarch('RetroArch / Stella 2014', 'stella2014'),
  ]),

  atari7800: windowsConfig('good', [
    windowsRetroarch('RetroArch / ProSystem', 'prosystem'),
    windowsStandalone('BizHawk (A78)', 'EmuHawk.exe'),
  ]),

  atarist: windowsConfig('good', [
    windowsRetroarch('RetroArch / Hatari', 'hatari'),
    windowsRetroarch('RetroArch / HatariB', 'hatarib'),
    windowsStandalone('Hatari', 'hatari.exe', ['--fullscreen', ROM_PATH_PLACEHOLDER]),
  ]),

  channelf: windowsConfig('good', [
    windowsRetroarch('RetroArch / FreeChaF', 'freechaf'),
  ]),

  colecovision: windowsConfig('good', [
    windowsRetroarch('RetroArch / Gearcoleco', 'gearcoleco'),
    windowsRetroarch('RetroArch / blueMSX', 'bluemsx'),
    windowsRetroarch('RetroArch / FinalBurn Neo', 'fbneo'),
    windowsStandalone('openMSX', 'openmsx.exe'),
    windowsStandalone('ares (ColecoVision)', 'ares.exe', ['--fullscreen', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('BizHawk (Coleco)', 'EmuHawk.exe'),
  ]),

  dreamcast: windowsConfig('good', [
    windowsRetroarch('RetroArch / Flycast', 'flycast'),
    windowsStandalone('Flycast', 'flycast.exe'),
    windowsStandalone('Redream', 'redream.exe'),
    windowsStandalone('Demul (Dreamcast)', 'demul.exe', ['-run=dc', `-image=${ROM_PATH_PLACEHOLDER}`]),
  ]),

  gamecube: windowsConfig('good', [
    windowsStandalone('Dolphin', 'Dolphin.exe', ['-b', '-e', ROM_PATH_PLACEHOLDER]),
    windowsRetroarch('RetroArch / Dolphin', 'dolphin'),
  ]),

  gamegear: windowsConfig('good', [
    windowsRetroarch('RetroArch / Genesis Plus GX', 'genesis_plus_gx'),
    windowsRetroarch('RetroArch / PicoDrive', 'picodrive'),
    windowsRetroarch('RetroArch / FinalBurn Neo', 'fbneo'),
    windowsStandalone('Mednafen (Game Gear)', 'mednafen.exe', ['-force_module', 'gg', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('ares (Game Gear)', 'ares.exe', ['--fullscreen', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('BizHawk (SMSHawk)', 'EmuHawk.exe'),
  ]),

  gb: windowsConfig('good', [
    windowsRetroarch('RetroArch / Gambatte', 'gambatte'),
    windowsRetroarch('RetroArch / TGB Dual', 'tgbdual'),
    windowsRetroarch('RetroArch / SameBoy', 'sameboy'),
    windowsStandalone('Mesen', 'Mesen.exe'),
    windowsStandalone('mGBA', 'mGBA.exe', ['-f', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('Mednafen (GB/GBC)', 'mednafen.exe'),
    windowsStandalone('ares (Game Boy / Color)', 'ares.exe', ['--fullscreen', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('BizHawk (Gambatte/GBHawk/SameBoy)', 'EmuHawk.exe'),
  ], 'Union of the coalesced RetroBat gb and gbc blocks; their common preferred core is Gambatte.'),

  gba: windowsConfig('good', [
    windowsRetroarch('RetroArch / mGBA', 'mgba'),
    windowsRetroarch('RetroArch / Beetle GBA', 'mednafen_gba'),
    windowsStandalone('mGBA', 'mGBA.exe', ['-f', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('NO$GBA', 'NO$GBA.EXE'),
    windowsStandalone('Mednafen (GBA)', 'mednafen.exe', ['-force_module', 'gba', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('ares (Game Boy Advance)', 'ares.exe', ['--fullscreen', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('BizHawk (mGBA)', 'EmuHawk.exe'),
  ]),

  jaguar: windowsConfig('good', [
    windowsRetroarch('RetroArch / Virtual Jaguar', 'virtualjaguar'),
    windowsStandalone('BigPEmu', 'BigPEmu.exe'),
    windowsStandalone('BizHawk (Jaguar)', 'EmuHawk.exe'),
    windowsStandalone('Phoenix', 'phoenix.exe'),
  ], 'RetroBat lists Virtual Jaguar first; BigPEmu is the materially better compatibility alternate.'),

  jaguarcd: windowsConfig('good', [
    windowsStandalone('BigPEmu', 'BigPEmu.exe'),
    windowsStandalone('BizHawk (Jaguar)', 'EmuHawk.exe'),
  ]),

  lynx: windowsConfig('good', [
    windowsRetroarch('RetroArch / Beetle Lynx', 'mednafen_lynx'),
    windowsRetroarch('RetroArch / Handy', 'handy'),
    windowsStandalone('Mednafen (Lynx)', 'mednafen.exe', ['-force_module', 'lynx', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('BizHawk (Handy)', 'EmuHawk.exe'),
  ]),

  mastersystem: windowsConfig('good', [
    windowsRetroarch('RetroArch / Genesis Plus GX', 'genesis_plus_gx'),
    windowsRetroarch('RetroArch / PicoDrive', 'picodrive'),
    windowsRetroarch('RetroArch / FinalBurn Neo', 'fbneo'),
    windowsStandalone('Mednafen (Master System)', 'mednafen.exe', ['-force_module', 'sms', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('ares (Master System)', 'ares.exe', ['--fullscreen', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('Kega Fusion (Master System)', 'Fusion.exe'),
    windowsStandalone('BizHawk (SMSHawk)', 'EmuHawk.exe'),
  ]),

  genesis: windowsConfig('good', [
    windowsRetroarch('RetroArch / Genesis Plus GX', 'genesis_plus_gx'),
    windowsRetroarch('RetroArch / Genesis Plus GX Wide', 'genesis_plus_gx_wide'),
    windowsRetroarch('RetroArch / PicoDrive', 'picodrive'),
    windowsRetroarch('RetroArch / FinalBurn Neo', 'fbneo'),
    windowsStandalone('Mednafen (Mega Drive)', 'mednafen.exe', ['-force_module', 'md', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('ares (Mega Drive)', 'ares.exe', ['--fullscreen', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('Kega Fusion (Mega Drive/Genesis)', 'Fusion.exe'),
    windowsStandalone('BizHawk (Genplus-gx)', 'EmuHawk.exe'),
  ]),

  n64: windowsConfig('good', [
    windowsRetroarch('RetroArch / Mupen64Plus-Next', 'mupen64plus_next'),
    windowsRetroarch('RetroArch / ParaLLEl N64', 'parallel_n64'),
    windowsStandalone('Mupen64Plus', 'mupen64plus-ui-console.exe', [ROM_PATH_PLACEHOLDER], 'RetroBat emulator id is confirmed; verify this bundled executable basename when resolving its directory.'),
    windowsStandalone('simple64', 'simple64-gui.exe', [ROM_PATH_PLACEHOLDER], 'Verify the bundled filename when the supervisor first resolves the RetroBat simple64 directory.'),
    windowsStandalone('ares (Nintendo 64)', 'ares.exe', ['--fullscreen', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('BizHawk (Ares64/Mupen64Plus)', 'EmuHawk.exe'),
    windowsStandalone('Project64', 'Project64.exe'),
  ]),

  n64dd: windowsConfig('workable', [
    windowsStandalone('Mupen64Plus', 'mupen64plus-ui-console.exe', [ROM_PATH_PLACEHOLDER], 'RetroBat emulator id is confirmed; verify this bundled executable basename when resolving its directory.'),
    windowsRetroarch('RetroArch / Mupen64Plus-Next', 'mupen64plus_next'),
    windowsRetroarch('RetroArch / ParaLLEl N64', 'parallel_n64'),
    windowsStandalone('ares (Nintendo 64DD)', 'ares.exe', ['--fullscreen', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('Project64', 'Project64.exe'),
  ]),

  nds: windowsConfig('good', [
    windowsRetroarch('RetroArch / melonDS DS', 'melondsds'),
    windowsRetroarch('RetroArch / DeSmuME', 'desmume'),
    windowsRetroarch('RetroArch / DeSmuME 2015', 'desmume2015'),
    windowsRetroarch('RetroArch / melonDS', 'melonds'),
    windowsStandalone('melonDS', 'melonDS.exe'),
    windowsStandalone('BizHawk (melonDS)', 'EmuHawk.exe'),
  ]),

  neogeo: windowsConfig('good', [
    windowsRetroarch('RetroArch / FinalBurn Neo', 'fbneo'),
    windowsRetroarch('RetroArch / FinalBurn Alpha', 'fbalpha'),
    windowsRetroarch('RetroArch / FBA 2012 Neo Geo', 'fbalpha2012_neogeo'),
    windowsRetroarch('RetroArch / Geolith', 'geolith'),
    windowsStandalone('Raine', 'raine64.exe'),
    windowsStandalone('MAME (Neo Geo)', 'mame.exe', ['neogeo', '-cart', ROM_PATH_PLACEHOLDER]),
  ]),

  nes: windowsConfig('good', [
    windowsRetroarch('RetroArch / FCEUmm', 'fceumm'),
    windowsRetroarch('RetroArch / Nestopia', 'nestopia'),
    windowsRetroarch('RetroArch / Mesen', 'mesen'),
    windowsStandalone('Mednafen (NES)', 'mednafen.exe', ['-force_module', 'nes', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('Mesen', 'Mesen.exe'),
    windowsStandalone('ares (Famicom)', 'ares.exe', ['--fullscreen', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('BizHawk (NesHawk/QuickNes)', 'EmuHawk.exe'),
  ]),

  pcengine: windowsConfig('good', [
    windowsRetroarch('RetroArch / Beetle PCE', 'mednafen_pce'),
    windowsRetroarch('RetroArch / Beetle PCE Fast', 'mednafen_pce_fast'),
    windowsRetroarch('RetroArch / FinalBurn Neo', 'fbneo'),
    windowsStandalone('Mednafen (PCE)', 'mednafen.exe', ['-force_module', 'pce', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('ares (PC Engine)', 'ares.exe', ['--fullscreen', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('BizHawk (HyperNyma/PCEHawk/TurboNyma)', 'EmuHawk.exe'),
    windowsStandalone('MagicEngine', 'pce.exe', [ROM_PATH_PLACEHOLDER], 'RetroBat lists MagicEngine; pce.exe is the conventional binary name but should be verified in that installed directory.'),
  ]),

  pcfx: windowsConfig('good', [
    windowsRetroarch('RetroArch / Beetle PC-FX', 'mednafen_pcfx'),
    windowsStandalone('Mednafen (PC-FX)', 'mednafen.exe', ['-force_module', 'pcfx', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('BizHawk (PCFX)', 'EmuHawk.exe'),
  ]),

  pokemini: windowsConfig('good', [
    windowsRetroarch('RetroArch / PokeMini', 'pokemini'),
  ]),

  ports: windowsConfig('workable', [
    windowsStandalone('RetroBat emulator launcher', 'emulatorLauncher.exe', [
      '-system', 'ports', '-emulator', 'libretro', '-rom', ROM_PATH_PLACEHOLDER,
    ], 'The .libretro descriptor selects a title-specific core; there is no truthful fixed core name for this system.'),
  ], 'This is intentionally RetroBat-specific. A future native supervisor should parse each .libretro descriptor instead of pretending all ports share one core.'),

  ps2: windowsConfig('good', [
    windowsStandalone('PCSX2 (auto)', 'pcsx2-qt.exe', ['-batch', '-fullscreen', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('PCSX2 (SSE4)', 'pcsx2-qt.exe', ['-batch', '-fullscreen', ROM_PATH_PLACEHOLDER], 'RetroBat core selector chooses the SSE4 build/directory.'),
    windowsStandalone('PCSX2 (AVX2)', 'pcsx2-qt.exe', ['-batch', '-fullscreen', ROM_PATH_PLACEHOLDER], 'RetroBat core selector chooses the AVX2 build/directory.'),
    windowsStandalone('PCSX2 1.6', 'pcsx2.exe', ['--nogui', '--fullscreen', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('Play!', 'Play!.exe'),
    windowsRetroarch('RetroArch / PCSX2', 'pcsx2'),
  ]),

  ps3: windowsConfig('workable', [
    windowsStandalone('RPCS3', 'rpcs3.exe', ['--no-gui', '--fullscreen', ROM_PATH_PLACEHOLDER]),
  ], 'Compatibility remains title- and CPU-dependent even though this is the installed working emulator.'),

  psp: windowsConfig('good', [
    windowsRetroarch('RetroArch / PPSSPP', 'ppsspp'),
    windowsStandalone('PPSSPP', 'PPSSPPWindows64.exe', ['--fullscreen', ROM_PATH_PLACEHOLDER]),
  ]),

  ps1: windowsConfig('good', [
    windowsRetroarch('RetroArch / Beetle PSX HW', 'beetle_psx_hw', 'RetroBat names this core mednafen_psx_hw.'),
    windowsRetroarch('RetroArch / SwanStation', 'swanstation'),
    windowsRetroarch('RetroArch / PCSX-ReARMed', 'pcsx_rearmed'),
    windowsStandalone('DuckStation', 'duckstation-qt-x64-ReleaseLTCG.exe', ['-batch', '-fullscreen', '--', ROM_PATH_PLACEHOLDER], 'DuckStation release filenames change; resolve this against the installed RetroBat duckstation directory rather than assuming a future package name.'),
    windowsStandalone('Mednafen (PSX)', 'mednafen.exe', ['-force_module', 'psx', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('BizHawk (Nymashock/Octoshock)', 'EmuHawk.exe'),
  ]),

  saturn: windowsConfig('good', [
    windowsRetroarch('RetroArch / Kronos', 'kronos'),
    windowsRetroarch('RetroArch / Beetle Saturn', 'mednafen_saturn'),
    windowsStandalone('Mednafen (Saturn)', 'mednafen.exe', ['-force_module', 'saturn', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('BizHawk (Saturnus)', 'EmuHawk.exe'),
    windowsStandalone('SSF', 'SSF.exe'),
  ]),

  sega32x: windowsConfig('workable', [
    windowsRetroarch('RetroArch / PicoDrive', 'picodrive'),
    windowsStandalone('ares (Mega 32X)', 'ares.exe', ['--fullscreen', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('Kega Fusion (32X)', 'Fusion.exe'),
    windowsStandalone('BizHawk (PicoDrive)', 'EmuHawk.exe'),
  ]),

  segacd: windowsConfig('good', [
    windowsRetroarch('RetroArch / Genesis Plus GX', 'genesis_plus_gx'),
    windowsRetroarch('RetroArch / Genesis Plus GX Wide', 'genesis_plus_gx_wide'),
    windowsRetroarch('RetroArch / PicoDrive', 'picodrive'),
    windowsStandalone('ares (Mega CD)', 'ares.exe', ['--fullscreen', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('Kega Fusion (Mega CD/Sega CD)', 'Fusion.exe'),
  ]),

  snes: windowsConfig('good', [
    windowsRetroarch('RetroArch / Snes9x', 'snes9x'),
    windowsRetroarch('RetroArch / bsnes', 'bsnes'),
    windowsRetroarch('RetroArch / bsnes HD beta', 'bsnes_hd_beta'),
    windowsRetroarch('RetroArch / Beetle SNES', 'mednafen_snes'),
    windowsRetroarch('RetroArch / Mesen-S', 'mesen-s'),
    windowsStandalone('Mednafen (SNES)', 'mednafen.exe', ['-force_module', 'snes', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('Mesen', 'Mesen.exe'),
    windowsStandalone('Snes9x', 'snes9x-x64.exe', ['-fullscreen', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('ares (Super Famicom)', 'ares.exe', ['--fullscreen', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('BizHawk (BSNES/Faust/Snes9x)', 'EmuHawk.exe'),
  ]),

  supergrafx: windowsConfig('good', [
    windowsRetroarch('RetroArch / Beetle SuperGrafx', 'mednafen_supergrafx'),
    windowsRetroarch('RetroArch / FinalBurn Neo', 'fbneo'),
    windowsStandalone('Mednafen (PCE)', 'mednafen.exe', ['-force_module', 'pce', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('ares (SuperGrafx)', 'ares.exe', ['--fullscreen', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('BizHawk (HyperNyma/PCEHawk/TurboNyma)', 'EmuHawk.exe'),
    windowsStandalone('MagicEngine', 'pce.exe', [ROM_PATH_PLACEHOLDER], 'RetroBat lists MagicEngine; pce.exe is the conventional binary name but should be verified in that installed directory.'),
  ]),

  switch: windowsConfig('workable', [
    windowsStandalone('Yuzu', 'yuzu.exe', ['-f', '-g', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('Yuzu Early Access', 'yuzu.exe', ['-f', '-g', ROM_PATH_PLACEHOLDER], 'Resolved from RetroBat\'s separate yuzu-early-access directory.'),
    windowsStandalone('Ryujinx', 'Ryujinx.exe'),
  ], 'The XML order is preserved, but both original upstream projects were discontinued; keep the known-working installed builds and keys/firmware together.'),

  triforce: windowsConfig('workable', [
    windowsStandalone('Dolphin Triforce', 'Dolphin.exe', ['-b', '-e', ROM_PATH_PLACEHOLDER]),
  ], 'This is RetroBat\'s dedicated dolphin-triforce directory, not ordinary Dolphin.'),

  virtualboy: windowsConfig('good', [
    windowsRetroarch('RetroArch / Beetle VB', 'mednafen_vb'),
    windowsStandalone('BizHawk (VirtualBoyee)', 'EmuHawk.exe'),
  ]),

  wii: windowsConfig('good', [
    windowsStandalone('Dolphin', 'Dolphin.exe', ['-b', '-e', ROM_PATH_PLACEHOLDER]),
    windowsRetroarch('RetroArch / Dolphin', 'dolphin'),
  ]),

  wiiu: windowsConfig('good', [
    windowsStandalone('Cemu', 'Cemu.exe', ['-f', '-g', ROM_PATH_PLACEHOLDER]),
  ]),

  windows: windowsConfig('good', [
    windowsStandalone('Windows shell launcher', 'cmd.exe', ['/d', '/s', '/c', 'start', '', ROM_PATH_PLACEHOLDER], 'The supervisor must pass argv directly and validate executable/shortcut paths; do not concatenate a command string.'),
  ], 'RetroBat labels this emulator windows. The file itself may be an .exe, shortcut, script, URL, archive wrapper, or launcher descriptor.'),

  xbox: windowsConfig('workable', [
    windowsStandalone('xemu', 'xemu.exe', ['-full-screen', '-dvd_path', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('Cxbx-Reloaded', 'Cxbx.exe'),
  ]),

  xbox360: windowsConfig('workable', [
    windowsStandalone('Xenia', 'xenia.exe', ['--fullscreen=true', ROM_PATH_PLACEHOLDER]),
    windowsStandalone('Xenia Canary', 'xenia_canary.exe', ['--fullscreen=true', ROM_PATH_PLACEHOLDER], 'Canary archive naming varies; resolve the actual file in RetroBat\'s xenia-canary directory.'),
  ], 'Xenia is Windows-only; no Linux cell is fabricated for it.'),
};

interface SystemMetadata {
  readonly retroBatIds: readonly string[];
  readonly fullname: string;
  readonly manufacturer: string;
  readonly release: number | null;
  readonly romExtensions: readonly string[];
}

/** Full names, makers, release years and extensions come from es_systems.cfg. */
const SYSTEM_METADATA: Readonly<Record<string, SystemMetadata>> = {
  '3ds': {
    retroBatIds: ['3ds'],
    fullname: 'Nintendo 3DS',
    manufacturer: 'Nintendo',
    release: 2011,
    romExtensions: ['.3ds', '.3dsx', '.elf', '.axf', '.cci', '.cxi', '.app'],
  },
  atari2600: {
    retroBatIds: ['atari2600'],
    fullname: 'Atari 2600',
    manufacturer: 'Atari',
    release: 1977,
    romExtensions: ['.7z', '.a26', '.bin', '.gz', '.rom', '.zip'],
  },
  atari5200: {
    retroBatIds: ['atari5200'],
    fullname: 'Atari 5200',
    manufacturer: 'Atari',
    release: 1982,
    romExtensions: ['.rom', '.xfd', '.atr', '.atx', '.cdm', '.cas', '.bin', '.a52', '.xex', '.zip', '.7z'],
  },
  atari7800: {
    retroBatIds: ['atari7800'],
    fullname: 'Atari 7800',
    manufacturer: 'Atari',
    release: 1986,
    romExtensions: ['.a78', '.bin', '.zip', '.7z'],
  },
  atarist: {
    retroBatIds: ['atarist'],
    fullname: 'Atari ST',
    manufacturer: 'Atari',
    release: 1985,
    romExtensions: ['.st', '.msa', '.stx', '.dim', '.ipf', '.m3u', '.gemdos', '.zip', '.7z'],
  },
  channelf: {
    retroBatIds: ['channelf'],
    fullname: 'Fairchild Channel F',
    manufacturer: 'Fairchild',
    release: 1976,
    romExtensions: ['.bin', '.rom', '.zip', '.7z'],
  },
  colecovision: {
    retroBatIds: ['colecovision'],
    fullname: 'ColecoVision',
    manufacturer: 'Coleco',
    release: 1982,
    romExtensions: ['.rom', '.ri', '.mx1', '.mx2', '.col', '.dsk', '.cas', '.sg', '.sc', '.m3u', '.zip'],
  },
  dreamcast: {
    retroBatIds: ['dreamcast'],
    fullname: 'Dreamcast',
    manufacturer: 'Sega',
    release: 1998,
    romExtensions: ['.mds', '.mdf', '.cue', '.cdi', '.gdi', '.chd', '.m3u'],
  },
  gamecube: {
    retroBatIds: ['gamecube'],
    fullname: 'GameCube',
    manufacturer: 'Nintendo',
    release: 2001,
    romExtensions: ['.gcz', '.iso', '.ciso', '.wbfs', '.wad', '.rvz', '.wia', '.m3u'],
  },
  gamegear: {
    retroBatIds: ['gamegear'],
    fullname: 'Game Gear',
    manufacturer: 'Sega',
    release: 1990,
    romExtensions: ['.gg', '.bin', '.zip', '.7z'],
  },
  gb: {
    retroBatIds: ['gb', 'gbc'],
    fullname: 'Game Boy / Game Boy Color',
    manufacturer: 'Nintendo',
    release: 1989,
    romExtensions: ['.gb', '.gbc', '.zip', '.7z'],
  },
  gba: {
    retroBatIds: ['gba'],
    fullname: 'Game Boy Advance',
    manufacturer: 'Nintendo',
    release: 2001,
    romExtensions: ['.gba', '.zip', '.7z'],
  },
  jaguar: {
    retroBatIds: ['jaguar'],
    fullname: 'Jaguar',
    manufacturer: 'Atari',
    release: 1993,
    romExtensions: ['.zip', '.7z', '.j64', '.jag', '.rom', '.abs', '.cof', '.bin', '.prg'],
  },
  jaguarcd: {
    retroBatIds: ['jaguarcd'],
    fullname: 'Jaguar CD',
    manufacturer: 'Atari',
    release: 1993,
    romExtensions: ['.cue', '.cdi'],
  },
  lynx: {
    retroBatIds: ['lynx'],
    fullname: 'Lynx',
    manufacturer: 'Atari',
    release: 1989,
    romExtensions: ['.lnx', '.zip', '.o', '.7z'],
  },
  mastersystem: {
    retroBatIds: ['mastersystem'],
    fullname: 'Master System - Mark III',
    manufacturer: 'Sega',
    release: 1985,
    romExtensions: ['.bin', '.sms', '.wad', '.zip', '.7z'],
  },
  genesis: {
    retroBatIds: ['megadrive'],
    fullname: 'Megadrive - Genesis',
    manufacturer: 'Sega',
    release: 1988,
    romExtensions: ['.68k', '.sgd', '.smd', '.bin', '.gen', '.md', '.sg', '.wad', '.zip', '.7z'],
  },
  n64: {
    retroBatIds: ['n64'],
    fullname: 'Nintendo 64',
    manufacturer: 'Nintendo',
    release: 1996,
    romExtensions: ['.v64', '.z64', '.n64', '.wad', '.zip', '.7z'],
  },
  n64dd: {
    retroBatIds: ['n64dd'],
    fullname: 'Nintendo 64 Disk Drive',
    manufacturer: 'Nintendo',
    release: 1999,
    romExtensions: ['.v64', '.z64', '.n64', '.wad', '.zip', '.7z', '.ndd'],
  },
  nds: {
    retroBatIds: ['nds'],
    fullname: 'Nintendo DS',
    manufacturer: 'Nintendo',
    release: 2004,
    romExtensions: ['.nds', '.bin', '.zip', '.7z'],
  },
  neogeo: {
    retroBatIds: ['neogeo'],
    fullname: 'Neo Geo',
    manufacturer: 'SNK',
    release: 1991,
    romExtensions: ['.zip', '.wad', '.neo', '.7z'],
  },
  nes: {
    retroBatIds: ['nes'],
    fullname: 'Nintendo Entertainment System - Famicom',
    manufacturer: 'Nintendo',
    release: 1983,
    romExtensions: ['.fds', '.nes', '.wad', '.zip', '.7z'],
  },
  pcengine: {
    retroBatIds: ['pcengine'],
    fullname: 'PC Engine',
    manufacturer: 'NEC',
    release: 1987,
    romExtensions: ['.pce', '.bin', '.zip', '.7z', '.wad'],
  },
  pcfx: {
    retroBatIds: ['pcfx'],
    fullname: 'PC-FX',
    manufacturer: 'NEC',
    release: 1994,
    romExtensions: ['.cue', '.ccd', '.toc', '.chd'],
  },
  pokemini: {
    retroBatIds: ['pokemini'],
    fullname: 'Pokemon-Mini',
    manufacturer: 'Nintendo',
    release: 2001,
    romExtensions: ['.min', '.zip', '.7z'],
  },
  ports: {
    retroBatIds: ['ports'],
    fullname: 'Ports',
    manufacturer: 'Ports',
    release: null,
    romExtensions: ['.libretro'],
  },
  ps2: {
    retroBatIds: ['ps2'],
    fullname: 'Playstation 2',
    manufacturer: 'Sony',
    release: 2000,
    romExtensions: ['.iso', '.cso', '.bin', '.mdf', '.gz', '.chd'],
  },
  ps3: {
    retroBatIds: ['ps3'],
    fullname: 'Playstation 3',
    manufacturer: 'Sony',
    release: 2006,
    romExtensions: ['.m3u', '.ps3', '.iso', '.7z', '.zip', '.rar', '.squashfs'],
  },
  psp: {
    retroBatIds: ['psp'],
    fullname: 'PlayStation Portable',
    manufacturer: 'Sony',
    release: 2004,
    romExtensions: ['.iso', '.cso', '.pbp', '.elf', '.prx', '.zip'],
  },
  ps1: {
    retroBatIds: ['psx'],
    fullname: 'PlayStation',
    manufacturer: 'Sony',
    release: 1994,
    romExtensions: ['.cue', '.img', '.mdf', '.pbp', '.toc', '.cbn', '.m3u', '.ccd', '.chd', '.zip', '.7z', '.iso', '.cso'],
  },
  saturn: {
    retroBatIds: ['saturn'],
    fullname: 'Saturn',
    manufacturer: 'Sega',
    release: 1995,
    romExtensions: ['.zip', '.cue', '.toc', '.m3u', '.ccd', '.chd', '.iso', '.cso', '.mds'],
  },
  sega32x: {
    retroBatIds: ['sega32x'],
    fullname: '32X',
    manufacturer: 'Sega',
    release: 1994,
    romExtensions: ['.32x', '.smd', '.bin', '.md', '.zip', '.7z'],
  },
  segacd: {
    retroBatIds: ['segacd'],
    fullname: 'Mega CD',
    manufacturer: 'Sega',
    release: 1991,
    romExtensions: ['.cue', '.iso', '.cso', '.zip', '.7z', '.chd', '.m3u'],
  },
  snes: {
    retroBatIds: ['snes'],
    fullname: 'Super Nintendo Entertainment System',
    manufacturer: 'Nintendo',
    release: 1990,
    romExtensions: ['.smc', '.fig', '.sfc', '.gd3', '.gd7', '.dx2', '.bsx', '.swc', '.rom', '.wad', '.zip', '.7z'],
  },
  supergrafx: {
    retroBatIds: ['supergrafx'],
    fullname: 'SuperGrafx',
    manufacturer: 'NEC',
    release: 1989,
    romExtensions: ['.pce', '.zip', '.7z', '.fba'],
  },
  switch: {
    retroBatIds: ['switch'],
    fullname: 'Switch',
    manufacturer: 'Nintendo',
    release: 2017,
    romExtensions: ['.nso', '.nro', '.nca', '.xci', '.nsp', '.kip'],
  },
  triforce: {
    retroBatIds: ['triforce'],
    fullname: 'Triforce',
    manufacturer: 'Sega',
    release: 2003,
    romExtensions: ['.iso', '.zip', '.cue'],
  },
  virtualboy: {
    retroBatIds: ['virtualboy'],
    fullname: 'Virtual Boy',
    manufacturer: 'Nintendo',
    release: 1995,
    romExtensions: ['.vb', '.vboy', '.bin', '.zip', '.7z'],
  },
  wii: {
    retroBatIds: ['wii'],
    fullname: 'Wii',
    manufacturer: 'Nintendo',
    release: 2006,
    romExtensions: ['.gcz', '.iso', '.ciso', '.wbfs', '.wad', '.rvz', '.wia'],
  },
  wiiu: {
    retroBatIds: ['wiiu'],
    fullname: 'Wii U',
    manufacturer: 'Nintendo',
    release: 2012,
    romExtensions: ['.iso', '.rpx', '.wud', '.wux', '.wua', '.m3u'],
  },
  windows: {
    retroBatIds: ['windows'],
    fullname: 'Windows',
    manufacturer: 'Microsoft',
    release: 1992,
    romExtensions: ['.exe', '.bat', '.cmd', '.lnk', '.game', '.url', '.pc', '.win', '.windows', '.wine', '.7z', '.zip', '.rar', '.wsquashfs'],
  },
  xbox: {
    retroBatIds: ['xbox'],
    fullname: 'Xbox',
    manufacturer: 'Microsoft',
    release: 2001,
    romExtensions: ['.xbe', '.iso'],
  },
  xbox360: {
    retroBatIds: ['xbox360'],
    fullname: 'Xbox 360',
    manufacturer: 'Microsoft',
    release: 2005,
    romExtensions: ['.iso', '.xex', '.xcp', '.zar', '.m3u'],
  },
};

/** Source-library ids that differ from the canonical keys above. */
export const EMULATOR_ID_ALIASES: Readonly<Record<string, string>> = {
  megadrive: 'genesis',
  psx: 'ps1',
  gbc: 'gb',
};

function linuxConfig(entry: LinuxSystemEntry): PlatformEmulatorEntry {
  return {
    coverage: entry.status,
    preferred: entry.emulators[0] ?? null,
    alternates: entry.emulators.slice(1),
    ...(entry.notes ? { notes: entry.notes } : {}),
  };
}

/**
 * Complete cross-platform catalog. Object construction is deterministic and
 * side-effect free, so this module is safe in Vite, Node, and the future daemon
 * tooling without importing browser-only library.ts.
 */
export const EMULATORS: Readonly<Record<string, EmulatorEntry>> =
  Object.fromEntries(
    Object.entries(SYSTEM_METADATA).map(([id, metadata]) => {
      const linux = LINUX_EMULATORS[id];
      const windows = WINDOWS_EMULATORS[id];
      const entry: EmulatorEntry = {
        id,
        ...metadata,
        bios: linux.bios,
        platforms: {
          linux: linuxConfig(linux),
          windows,
        },
      };
      return [id, entry];
    }),
  );

export const EMULATOR_ENTRIES: readonly EmulatorEntry[] =
  Object.values(EMULATORS);

/** Normalize a RetroBat source id or shell id without inventing unknown ids. */
export function canonicalEmulatorId(systemId: string): string {
  const normalized = systemId.trim().toLowerCase();
  return EMULATOR_ID_ALIASES[normalized] ?? normalized;
}

/** Return full extensions, BIOS, and both platform records for a known id. */
export function emulatorEntryById(systemId: string): EmulatorEntry | undefined {
  return EMULATORS[canonicalEmulatorId(systemId)];
}

/** Required platform-aware lookup; unknown systems return undefined. */
export function emulatorById(
  systemId: string,
  platform: Platform,
): PlatformEmulatorEntry | undefined {
  return emulatorEntryById(systemId)?.platforms[platform];
}

/** Convenience lookup when callers need the system record and chosen OS cell. */
export function lookupEmulator(
  systemId: string,
  platform: Platform,
): EmulatorLookup | undefined {
  const entry = emulatorEntryById(systemId);
  if (!entry) return undefined;
  return { entry, platform, config: entry.platforms[platform] };
}
