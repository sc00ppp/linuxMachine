import type { JSX, ReactNode } from 'react';

const BODY = 'var(--console-body, #d9d5cf)';
const DARK = 'var(--console-dark, #2a2733)';
const ACCENT = 'var(--accent)';
const LINE = 'rgba(0, 0, 0, 0.38)';
const SOFT_LINE = 'rgba(0, 0, 0, 0.22)';
const SHADOW = 'rgba(0, 0, 0, 0.2)';
const HIGHLIGHT = 'rgba(255, 255, 255, 0.24)';

interface ArtSvgProps {
  title: string;
  className?: string;
  children: ReactNode;
}

/**
 * Every machine uses the same drawing primitives and line treatment so the
 * catalog reads as one illustrated collection despite four decades of shapes.
 */
function ArtSvg({ title, className, children }: ArtSvgProps): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 240 160"
      role="img"
      aria-label={title}
      focusable="false"
    >
      <title>{title}</title>
      <g
        stroke={LINE}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </g>
    </svg>
  );
}

function Ground({ cx = 120, cy = 145, rx = 94 }: { cx?: number; cy?: number; rx?: number }) {
  return (
    <ellipse
      cx={cx}
      cy={cy}
      rx={rx}
      ry="7"
      fill={SHADOW}
      stroke="none"
    />
  );
}

function Dpad({
  x,
  y,
  size = 23,
  fill = DARK,
}: {
  x: number;
  y: number;
  size?: number;
  fill?: string;
}) {
  const third = size / 3;
  const half = size / 2;
  return (
    <g>
      <path
        d={[
          `M${x - third / 2} ${y - half}`,
          `h${third}v${third}`,
          `h${third}v${third}`,
          `h-${third}v${third}`,
          `h-${third}v-${third}`,
          `h-${third}v-${third}`,
          `h${third}Z`,
        ].join(' ')}
        fill={fill}
      />
      <circle cx={x} cy={y} r={third * 0.22} fill={HIGHLIGHT} stroke="none" />
    </g>
  );
}

function NesArt({ className }: { className?: string }): JSX.Element {
  return (
    <ArtSvg title="Nintendo Entertainment System console and controller" className={className}>
      <Ground />

      {/* The stepped front and oversized black cartridge bay define the NES. */}
      <path d="M24 52 37 39h111l15 13v59H24Z" fill={BODY} />
      <path d="M24 52h139v23H24Z" fill={BODY} />
      <path d="M37 39h111l15 13H24Z" fill={HIGHLIGHT} />
      <rect x="43" y="47" width="100" height="24" rx="2.5" fill={DARK} />
      <path d="M50 54h86M50 61h86" fill="none" stroke={SOFT_LINE} />
      <path d="M25 76h138v35H25Z" fill={BODY} />
      <path d="M35 83h82v20H35Z" fill={DARK} />
      <rect x="42" y="88" width="68" height="10" rx="1.5" fill="rgba(255,255,255,.08)" />
      <path d="M123 83h30v20h-30Z" fill="rgba(0,0,0,.08)" />
      <circle cx="132" cy="94" r="3.4" fill={ACCENT} />
      <rect x="140" y="89.5" width="8" height="8" rx="1.5" fill={DARK} />
      <path d="M31 111v5h126v-5" fill={DARK} />
      <path d="M30 77h132" fill="none" stroke={HIGHLIGHT} />

      {/* Rectangular brick pad, with the famous red A/B pair. */}
      <path d="M142 103c10-5 19-5 28 0" fill="none" />
      <rect x="132" y="99" width="83" height="42" rx="4" fill={BODY} />
      <rect x="137" y="104" width="73" height="32" rx="2" fill={DARK} />
      <rect x="165" y="107" width="40" height="26" rx="2" fill={BODY} />
      <Dpad x={150} y={120} size={24} />
      <rect x="169" y="122" width="12" height="4" rx="2" fill={DARK} />
      <rect x="184" y="122" width="12" height="4" rx="2" fill={DARK} />
      <circle cx="190" cy="112" r="5" fill={ACCENT} />
      <circle cx="202" cy="112" r="5" fill={ACCENT} />
      <path d="M137 104h73" fill="none" stroke={HIGHLIGHT} />
    </ArtSvg>
  );
}

function SnesArt({ className }: { className?: string }): JSX.Element {
  return (
    <ArtSvg title="Super Nintendo console and controller" className={className}>
      <Ground />

      {/* US SNES: broad lavender-grey deck, raised cartridge well, twin sliders. */}
      <path
        d="M25 61c0-10 8-18 18-18h98c11 0 20 9 20 20v43c0 8-6 14-14 14H38c-7 0-13-6-13-13Z"
        fill={BODY}
      />
      <path d="M31 61c8-9 16-13 28-13h75c11 0 17 5 21 13Z" fill={HIGHLIGHT} />
      <path d="M25 70h136v36H25Z" fill="rgba(0,0,0,.05)" />
      <rect x="56" y="48" width="70" height="28" rx="8" fill="rgba(0,0,0,.1)" />
      <rect x="65" y="53" width="52" height="17" rx="3" fill={DARK} />
      <path d="M71 58h40M71 64h40" fill="none" stroke={SOFT_LINE} />
      <rect x="39" y="72" width="9" height="27" rx="4.5" fill={DARK} />
      <rect x="136" y="72" width="9" height="27" rx="4.5" fill={DARK} />
      <circle cx="42.5" cy="109" r="3" fill={ACCENT} />
      <circle cx="140.5" cy="109" r="3" fill={ACCENT} />
      <path d="M57 87h70M60 94h64" fill="none" stroke={SOFT_LINE} />
      <path d="M30 119v5h126v-6" fill={DARK} />

      {/* The dog-bone controller and four-color face cluster. */}
      <path d="M150 105c7-6 14-8 23-5h21c10-3 18-1 24 6 7 8 6 24-1 33-5 7-13 7-20 1l-8-7h-11l-9 7c-7 6-16 5-20-2-6-9-6-25 1-33Z" fill={BODY} />
      <path d="M157 108c8-5 14-5 20-2h17c7-3 13-2 18 3" fill="none" stroke={HIGHLIGHT} />
      <Dpad x={163} y={120} size={21} />
      <circle cx="198" cy="114" r="4.3" fill={ACCENT} />
      <circle cx="208" cy="120" r="4.3" fill={ACCENT} />
      <circle cx="198" cy="126" r="4.3" fill={DARK} />
      <circle cx="188" cy="120" r="4.3" fill={DARK} />
      <rect x="174" y="119" width="7" height="3" rx="1.5" fill={DARK} />
      <rect x="182" y="119" width="7" height="3" rx="1.5" fill={DARK} />
      <path d="M154 103 158 99M210 102l4-4" fill="none" />
    </ArtSvg>
  );
}

function N64Art({ className }: { className?: string }): JSX.Element {
  return (
    <ArtSvg title="Nintendo 64 console and trident controller" className={className}>
      <Ground />

      {/* Low, eyebrow-curved deck with the cartridge chimney at center. */}
      <path
        d="M22 72c8-19 28-28 52-28h46c25 0 44 10 51 29l9 31c2 8-4 15-12 15H31c-9 0-15-8-12-16Z"
        fill={DARK}
      />
      <path d="M30 73c15-13 28-16 47-15h41c21-1 37 5 53 18l-4-12c-8-13-24-20-47-20H74c-22 0-38 7-46 21Z" fill="rgba(255,255,255,.09)" />
      <path d="M45 64c12-10 28-13 48-13s36 3 49 13l-5 22H50Z" fill="rgba(0,0,0,.12)" />
      <path d="M73 42 80 28h39l8 14Z" fill={DARK} />
      <rect x="84" y="33" width="31" height="10" rx="2" fill="rgba(255,255,255,.08)" />
      <path d="M43 83c15 7 31 10 51 10s38-3 55-10" fill="none" stroke={SOFT_LINE} />
      <rect x="57" y="98" width="73" height="13" rx="5" fill="rgba(0,0,0,.36)" />
      <circle cx="72" cy="104.5" r="3.5" fill={ACCENT} />
      <circle cx="118" cy="104.5" r="3.5" fill="rgba(255,255,255,.14)" />
      <path d="M30 117v6h25l4-5M166 117v6h-25l-4-5" fill={DARK} />
      <path d="M93 65v21" fill="none" stroke={HIGHLIGHT} />

      {/* Three prongs and central analog stick make this readable at a glance. */}
      <path
        d="M147 98c-8 1-13 8-11 16l7 27c2 8 10 10 15 4l14-18 2 22c1 8 12 9 15 1l7-22 13 17c5 6 13 4 15-4l7-27c2-8-4-15-12-16-9-1-16 2-23 6h-17c-7-4-14-7-22-6Z"
        fill={BODY}
      />
      <path d="M142 108c9-5 17-3 26 2h21c9-5 17-7 26-2" fill="none" stroke={HIGHLIGHT} />
      <Dpad x={154} y={114} size={17} />
      <circle cx="180" cy="118" r="8" fill={DARK} />
      <circle cx="180" cy="116" r="4.5" fill={BODY} />
      <circle cx="207" cy="111" r="4" fill={ACCENT} />
      <circle cx="215" cy="118" r="4" fill={ACCENT} />
      <circle cx="200" cy="120" r="3.2" fill={DARK} />
      <path d="M202 128h11M204 132h8" fill="none" stroke={ACCENT} />
      <circle cx="180" cy="134" r="2.8" fill={ACCENT} />
    </ArtSvg>
  );
}

function GameCubeArt({ className }: { className?: string }): JSX.Element {
  return (
    <ArtSvg title="Nintendo GameCube console and controller" className={className}>
      <Ground />

      {/* A compact cube, circular lid, rear carry handle, and four front ports. */}
      <path d="M49 36V22c0-6 5-10 11-10h69c6 0 11 4 11 10v14" fill="none" stroke={DARK} strokeWidth="7" />
      <path d="M39 36h111v96H39Z" fill={DARK} />
      <path d="m39 36 12-9h87l12 9Z" fill="rgba(255,255,255,.13)" />
      <path d="M47 43h95v44H47Z" fill="rgba(255,255,255,.06)" />
      <ellipse cx="94.5" cy="54" rx="37" ry="13" fill="rgba(0,0,0,.28)" />
      <ellipse cx="94.5" cy="51" rx="30" ry="9" fill={DARK} />
      <circle cx="94.5" cy="51" r="4" fill={ACCENT} />
      <path d="M55 75h79" fill="none" stroke={SOFT_LINE} />
      <rect x="48" y="91" width="94" height="33" rx="3" fill="rgba(0,0,0,.26)" />
      <circle cx="61" cy="105" r="7.5" fill={DARK} />
      <circle cx="82" cy="105" r="7.5" fill={DARK} />
      <circle cx="103" cy="105" r="7.5" fill={DARK} />
      <circle cx="124" cy="105" r="7.5" fill={DARK} />
      <circle cx="61" cy="105" r="2.5" fill="rgba(255,255,255,.18)" />
      <circle cx="82" cy="105" r="2.5" fill="rgba(255,255,255,.18)" />
      <circle cx="103" cy="105" r="2.5" fill="rgba(255,255,255,.18)" />
      <circle cx="124" cy="105" r="2.5" fill="rgba(255,255,255,.18)" />
      <path d="M44 132v5h18v-5M128 132v5h17v-5" fill={DARK} />

      {/* Asymmetric bean pad with oversized green A and yellow C stick. */}
      <path
        d="M158 92c-9 4-13 13-11 24l5 25c2 9 12 11 18 4l11-13h16l11 13c6 7 16 5 18-4l5-25c2-11-2-20-11-24-8-4-18-1-27 5h-8c-9-6-19-9-27-5Z"
        fill={BODY}
      />
      <circle cx="166" cy="108" r="8" fill={DARK} />
      <circle cx="166" cy="106.5" r="4.5" fill={BODY} />
      <Dpad x={169} y={124} size={14} />
      <circle cx="205" cy="111" r="7" fill={ACCENT} />
      <circle cx="216" cy="104" r="4.5" fill={DARK} />
      <circle cx="217" cy="119" r="3.6" fill={DARK} />
      <circle cx="199" cy="125" r="4.3" fill={ACCENT} />
      <rect x="184" y="112" width="8" height="3" rx="1.5" fill={DARK} />
      <path d="M155 97c8-4 17-1 26 5h16c8-6 17-8 25-4" fill="none" stroke={HIGHLIGHT} />
    </ArtSvg>
  );
}

function WiiArt({ className }: { className?: string }): JSX.Element {
  return (
    <ArtSvg title="Nintendo Wii console in its stand with Wii Remote" className={className}>
      <Ground cx={120} rx={82} />

      {/* The slightly tilted white book in a grey cradle. */}
      <path d="M39 132 49 119h78l13 13v8H39Z" fill={DARK} />
      <path d="M55 23 116 20l11 105-69 3Z" fill={BODY} />
      <path d="M55 23 63 18l55-2-2 4Z" fill={HIGHLIGHT} />
      <path d="m116 20 8 5 11 95-8 5Z" fill="rgba(0,0,0,.12)" />
      <path d="M65 30h47" fill="none" stroke={SOFT_LINE} />
      <path d="M64 39h49" fill="none" stroke={DARK} strokeWidth="3" />
      <path d="M67 46h44" fill="none" stroke={SOFT_LINE} />
      <circle cx="68" cy="115" r="3.5" fill={ACCENT} />
      <circle cx="80" cy="115" r="2.5" fill="rgba(0,0,0,.18)" />
      <path d="M48 132h88" fill="none" stroke={HIGHLIGHT} />

      {/* Remote: speaker dots, Home button, one/two keys, and wrist cord. */}
      <rect x="158" y="24" width="31" height="108" rx="6" fill={BODY} />
      <path d="M162 29h23" fill="none" stroke={HIGHLIGHT} />
      <rect x="165" y="34" width="17" height="26" rx="2" fill={DARK} />
      <circle cx="173.5" cy="69" r="4.5" fill={ACCENT} />
      <Dpad x={173.5} y={82} size={15} />
      <circle cx="173.5" cy="96" r="3.5" fill={BODY} />
      <circle cx="166.5" cy="96" r="2" fill={DARK} />
      <circle cx="180.5" cy="96" r="2" fill={DARK} />
      <circle cx="168.5" cy="106" r="1.2" fill={DARK} />
      <circle cx="173.5" cy="106" r="1.2" fill={DARK} />
      <circle cx="178.5" cy="106" r="1.2" fill={DARK} />
      <circle cx="168.5" cy="111" r="1.2" fill={DARK} />
      <circle cx="173.5" cy="111" r="1.2" fill={DARK} />
      <circle cx="178.5" cy="111" r="1.2" fill={DARK} />
      <rect x="166" y="118" width="15" height="4" rx="2" fill={DARK} />
      <rect x="166" y="124" width="15" height="4" rx="2" fill={DARK} />
      <path d="M174 132c2 8 14 6 15 14" fill="none" stroke={SOFT_LINE} />
    </ArtSvg>
  );
}

function GameBoyArt({ className }: { className?: string }): JSX.Element {
  return (
    <ArtSvg title="Original Nintendo Game Boy handheld" className={className}>
      <Ground cx={121} cy={150} rx={58} />

      {/* Portrait slab, olive screen, speaker grille, and clipped lower corner. */}
      <path
        d="M76 10h91c8 0 14 6 14 14v105c0 13-8 21-21 21H76c-9 0-16-7-16-16V26c0-9 7-16 16-16Z"
        fill={BODY}
      />
      <path d="M67 17h107" fill="none" stroke={HIGHLIGHT} />
      <path d="M60 28h121" fill="none" stroke={SOFT_LINE} />
      <path d="M70 34h101v60H70Z" fill={DARK} />
      <path d="M82 43h76v42H82Z" fill={ACCENT} opacity=".7" />
      <path d="M88 48h64v31H88Z" fill="rgba(0,0,0,.2)" />
      <circle cx="76" cy="76" r="2.5" fill={ACCENT} />
      <path d="M83 90h75" fill="none" stroke="rgba(255,255,255,.13)" />
      <path d="M77 99h86" fill="none" stroke={SOFT_LINE} />
      <Dpad x={88} y={119} size={25} />
      <circle cx="144" cy="111" r="6.5" fill={ACCENT} />
      <circle cx="158" cy="119" r="6.5" fill={ACCENT} />
      <rect x="108" y="135" width="15" height="4" rx="2" transform="rotate(-12 108 135)" fill={DARK} />
      <rect x="127" y="135" width="15" height="4" rx="2" transform="rotate(-12 127 135)" fill={DARK} />
      <path d="M154 132l4 8M148 134l4 8M142 136l4 8M136 138l4 8M130 140l3 6" fill="none" stroke={DARK} strokeWidth="2.4" />
      <circle cx="71" cy="22" r="1.5" fill="rgba(0,0,0,.12)" />
      <circle cx="79" cy="22" r="1.5" fill="rgba(0,0,0,.12)" />
      <circle cx="87" cy="22" r="1.5" fill="rgba(0,0,0,.12)" />
    </ArtSvg>
  );
}

function GenesisArt({ className }: { className?: string }): JSX.Element {
  return (
    <ArtSvg title="Sega Genesis console and three-button controller" className={className}>
      <Ground />

      {/* Flattened black oval with its raised 16-bit cartridge medallion. */}
      <path
        d="M19 77c0-22 21-37 48-37h54c28 0 48 15 48 37v30c0 11-9 20-20 20H39c-11 0-20-9-20-20Z"
        fill={DARK}
      />
      <path d="M25 77c8-21 26-29 52-29h35c25 0 43 8 51 29" fill="none" stroke={HIGHLIGHT} />
      <ellipse cx="95" cy="74" rx="43" ry="28" fill="rgba(0,0,0,.28)" />
      <ellipse cx="95" cy="72" rx="32" ry="20" fill={DARK} />
      <rect x="75" y="61" width="40" height="10" rx="2" fill="rgba(255,255,255,.08)" />
      <path d="M77 67h36" fill="none" stroke={SOFT_LINE} />
      <circle cx="95" cy="80" r="7" fill="rgba(255,255,255,.08)" />
      <path d="M91 76h8v8h-8Z" fill={ACCENT} />
      <rect x="29" y="88" width="43" height="25" rx="3" fill="rgba(0,0,0,.3)" />
      <path d="M35 94h31M35 100h31M35 106h31" fill="none" stroke={SOFT_LINE} />
      <path d="M119 91h38" fill="none" stroke={ACCENT} strokeWidth="3" />
      <rect x="135" y="100" width="17" height="8" rx="4" fill={ACCENT} />
      <path d="M26 126v5h24v-4M139 127v4h22v-6" fill={DARK} />

      {/* Wide kidney pad with three buttons in a rising arc. */}
      <path
        d="M145 102c-9 5-13 16-10 27l3 11c3 10 14 13 21 5l10-11h28l10 11c7 8 18 5 21-5l3-11c3-11-1-22-10-27-10-6-20-3-30 2h-16c-10-5-20-8-30-2Z"
        fill={DARK}
      />
      <path d="M141 112c11-7 21-5 31 0h22c10-5 20-7 31 0" fill="none" stroke="rgba(255,255,255,.12)" />
      <Dpad x={156} y={121} size={20} fill={BODY} />
      <circle cx="196" cy="124" r="4.5" fill={ACCENT} />
      <circle cx="207" cy="120" r="4.5" fill={ACCENT} />
      <circle cx="217" cy="115" r="4.5" fill={ACCENT} />
      <rect x="177" y="121" width="9" height="3.5" rx="1.75" fill={BODY} />
      <path d="M151 103 155 98M216 102l4-5" fill="none" />
    </ArtSvg>
  );
}

function SaturnArt({ className }: { className?: string }): JSX.Element {
  return (
    <ArtSvg title="Sega Saturn console and controller" className={className}>
      <Ground />

      {/* Broad angular deck, giant round CD lid, left-side access buttons. */}
      <path d="m24 55 15-13h112l15 13 9 64H18Z" fill={BODY} />
      <path d="M39 42h112l15 13H24Z" fill={HIGHLIGHT} />
      <path d="m25 59 140-1 6 44H20Z" fill="rgba(0,0,0,.07)" />
      <ellipse cx="101" cy="70" rx="47" ry="23" fill="rgba(0,0,0,.2)" />
      <ellipse cx="101" cy="68" rx="40" ry="18" fill={BODY} />
      <path d="M67 68c10-10 58-10 68 0" fill="none" stroke={SOFT_LINE} />
      <circle cx="101" cy="68" r="4" fill={ACCENT} />
      <rect x="31" y="67" width="16" height="7" rx="3.5" fill={DARK} />
      <circle cx="39" cy="86" r="5" fill={DARK} />
      <circle cx="154" cy="87" r="5" fill={ACCENT} />
      <path d="M30 98h126M33 104h120M36 110h114" fill="none" stroke={SOFT_LINE} />
      <rect x="56" y="113" width="83" height="6" rx="2" fill="rgba(0,0,0,.3)" />
      <path d="M24 119v6h27v-6M143 119v6h28v-6" fill={DARK} />

      {/* Saturn's slim six-button pad, still distinctly Sega-shaped. */}
      <path
        d="M141 105c-8 5-11 16-8 27l3 9c3 9 14 11 20 4l9-11h39l9 11c6 7 17 5 20-4l3-9c3-11 0-22-8-27-9-6-20-4-30 1h-27c-10-5-21-7-30-1Z"
        fill={DARK}
      />
      <path d="M139 114c11-7 22-5 32 0h27c10-5 21-7 32 0" fill="none" stroke="rgba(255,255,255,.12)" />
      <Dpad x={153} y={121} size={19} fill={BODY} />
      <circle cx="197" cy="125" r="3.6" fill={ACCENT} />
      <circle cx="207" cy="122" r="3.6" fill={ACCENT} />
      <circle cx="217" cy="119" r="3.6" fill={ACCENT} />
      <circle cx="196" cy="116" r="2.7" fill={BODY} />
      <circle cx="205" cy="113" r="2.7" fill={BODY} />
      <circle cx="214" cy="110" r="2.7" fill={BODY} />
      <rect x="174" y="120" width="10" height="3" rx="1.5" fill={BODY} />
    </ArtSvg>
  );
}

function DreamcastArt({ className }: { className?: string }): JSX.Element {
  return (
    <ArtSvg title="Sega Dreamcast console and controller" className={className}>
      <Ground />

      {/* Compact white trapezoid, circular lid, and the signature orange spiral. */}
      <path d="m31 45 13-10h105l13 10 12 75H20Z" fill={BODY} />
      <path d="M44 35h105l13 10H31Z" fill={HIGHLIGHT} />
      <ellipse cx="99" cy="66" rx="46" ry="24" fill="rgba(0,0,0,.1)" />
      <ellipse cx="99" cy="63" rx="39" ry="19" fill={BODY} />
      <path
        d="M101 54c9 1 13 8 10 14-3 7-14 9-22 5-8-4-9-13-3-18 7-6 19-5 27 2 9 9 5 22-6 27-13 6-30 1-36-10"
        fill="none"
        stroke={ACCENT}
        strokeWidth="2.8"
      />
      <circle cx="39" cy="77" r="5.5" fill={DARK} />
      <circle cx="155" cy="77" r="5.5" fill={ACCENT} />
      <path d="M29 91h138" fill="none" stroke={SOFT_LINE} />
      <circle cx="52" cy="107" r="7" fill={DARK} />
      <circle cx="82" cy="107" r="7" fill={DARK} />
      <circle cx="112" cy="107" r="7" fill={DARK} />
      <circle cx="142" cy="107" r="7" fill={DARK} />
      <circle cx="52" cy="107" r="2" fill="rgba(255,255,255,.18)" />
      <circle cx="82" cy="107" r="2" fill="rgba(255,255,255,.18)" />
      <circle cx="112" cy="107" r="2" fill="rgba(255,255,255,.18)" />
      <circle cx="142" cy="107" r="2" fill="rgba(255,255,255,.18)" />
      <path d="M25 120v6h28v-6M141 120v6h28v-6" fill={DARK} />

      {/* Winged controller with the square VMU window at its center. */}
      <path
        d="M149 100c-9 2-14 12-12 22l5 22c2 8 12 10 17 3l12-16h31l12 16c5 7 15 5 17-3l5-22c2-10-3-20-12-22-10-3-18 2-27 8h-21c-9-6-17-11-27-8Z"
        fill={BODY}
      />
      <rect x="175" y="105" width="27" height="25" rx="3" fill={DARK} />
      <rect x="180" y="109" width="17" height="11" rx="1" fill={ACCENT} opacity=".65" />
      <path d="M181 125h15" fill="none" stroke={HIGHLIGHT} />
      <circle cx={157} cy={105} r={6.2} fill={DARK} />
      <circle cx={157} cy={103.5} r={3.2} fill={BODY} />
      <Dpad x={155} y={117} size={17} />
      <circle cx="218" cy="113" r="3.7" fill={ACCENT} />
      <circle cx="225" cy="120" r="3.7" fill={DARK} />
      <circle cx="211" cy="120" r="3.7" fill={DARK} />
      <circle cx="218" cy="127" r="3.7" fill={DARK} />
    </ArtSvg>
  );
}

function Ps1Art({ className }: { className?: string }): JSX.Element {
  return (
    <ArtSvg title="Original PlayStation console and controller" className={className}>
      <Ground />

      {/* Low square deck with a dominant circular disc lid and round controls. */}
      <path d="m24 51 12-10h117l12 10 8 67H18Z" fill={BODY} />
      <path d="M36 41h117l12 10H24Z" fill={HIGHLIGHT} />
      <ellipse cx="96" cy="68" rx="48" ry="27" fill="rgba(0,0,0,.11)" />
      <ellipse cx="96" cy="65" rx="42" ry="22" fill={BODY} />
      <circle cx="96" cy="65" r="6" fill={ACCENT} />
      <path d="M92 62h9v7h-9Z" fill={DARK} />
      <circle cx="37" cy="76" r="8" fill={BODY} />
      <circle cx="153" cy="76" r="8" fill={BODY} />
      <circle cx="37" cy="76" r="3" fill={ACCENT} />
      <path d="M148 76h10" fill="none" stroke={DARK} />
      <path d="M28 91h136" fill="none" stroke={SOFT_LINE} />
      <rect x="40" y="99" width="49" height="16" rx="2" fill="rgba(0,0,0,.26)" />
      <rect x="101" y="99" width="49" height="16" rx="2" fill="rgba(0,0,0,.26)" />
      <circle cx="53" cy="107" r="4.3" fill={DARK} />
      <circle cx="75" cy="107" r="4.3" fill={DARK} />
      <circle cx="114" cy="107" r="4.3" fill={DARK} />
      <circle cx="136" cy="107" r="4.3" fill={DARK} />
      <path d="M24 118v6h28v-6M140 118v6h28v-6" fill={DARK} />

      {/* Original pre-analog pad: angular grips and the four symbol buttons. */}
      <path
        d="M149 100c-9 1-15 9-14 18l4 24c1 9 11 13 18 7l15-14h31l15 14c7 6 17 2 18-7l4-24c1-9-5-17-14-18-10-1-17 4-25 9h-26c-8-5-16-10-26-9Z"
        fill={BODY}
      />
      <path d="M143 111c11-7 20-4 30 2h31c10-6 19-9 30-2" fill="none" stroke={HIGHLIGHT} />
      <Dpad x={154} y={119} size={20} />
      <circle cx="220" cy="111" r="4.2" fill="none" stroke={ACCENT} />
      <path d="m229 118-4 7h8Z" fill="none" stroke={ACCENT} />
      <path d="m214 125 7 7M221 125l-7 7" fill="none" stroke={ACCENT} />
      <rect x="204" y="115" width="7" height="7" fill="none" stroke={ACCENT} />
      <rect x="175" y="119" width="10" height="3" rx="1.5" fill={DARK} />
      <rect x="189" y="119" width="10" height="3" rx="1.5" fill={DARK} />
    </ArtSvg>
  );
}

function Ps2Art({ className }: { className?: string }): JSX.Element {
  return (
    <ArtSvg title="PlayStation 2 console tower and DualShock controller" className={className}>
      <Ground />

      {/* Vertical ribbed monolith on its slim blue-black foot. */}
      <path d="M53 132h98v9H53Z" fill={DARK} />
      <path d="M67 20h67v112H67Z" fill={DARK} />
      <path d="m67 20 8-7h66l-7 7Z" fill="rgba(255,255,255,.13)" />
      <path d="m134 20 7-7v111l-7 8Z" fill="rgba(0,0,0,.35)" />
      <path d="M74 26h53M74 34h53M74 42h53M74 50h53M74 58h53M74 66h53M74 74h53M74 82h53M74 90h53M74 98h53M74 106h53M74 114h53" fill="none" stroke="rgba(255,255,255,.1)" />
      <rect x="78" y="27" width="6" height="66" rx="1" fill="rgba(0,0,0,.45)" />
      <path d="M80 31h2v57h-2Z" fill={ACCENT} stroke="none" />
      <rect x="89" y="103" width="31" height="4" rx="2" fill="rgba(0,0,0,.55)" />
      <circle cx="83" cy="117" r="3.2" fill={ACCENT} />
      <circle cx="94" cy="117" r="2.2" fill="rgba(255,255,255,.2)" />
      <path d="M91 17h26v4H91Z" fill={ACCENT} stroke="none" />

      {/* Familiar twin-stick DualShock keeps the tower from feeling generic. */}
      <path
        d="M151 91c-9 1-15 9-14 18l4 30c1 9 11 13 18 7l15-15h31l15 15c7 6 17 2 18-7l4-30c1-9-5-17-14-18-10-1-18 4-26 10h-25c-8-6-16-11-26-10Z"
        fill={BODY}
      />
      <path d="M144 102c11-7 20-4 31 3h29c11-7 20-10 31-3" fill="none" stroke={HIGHLIGHT} />
      <Dpad x={155} y={112} size={18} />
      <circle cx="221" cy="104" r="3.7" fill="none" stroke={ACCENT} />
      <path d="m230 111-4 6h8Z" fill="none" stroke={ACCENT} />
      <path d="m215 118 6 6M221 118l-6 6" fill="none" stroke={ACCENT} />
      <rect x="205" y="109" width="6" height="6" fill="none" stroke={ACCENT} />
      <circle cx="177" cy="126" r="6.5" fill={DARK} />
      <circle cx="202" cy="126" r="6.5" fill={DARK} />
      <circle cx="177" cy="124.5" r="3" fill={BODY} />
      <circle cx="202" cy="124.5" r="3" fill={BODY} />
      <rect x="178" y="110" width="8" height="3" rx="1.5" fill={DARK} />
      <rect x="191" y="110" width="8" height="3" rx="1.5" fill={DARK} />
    </ArtSvg>
  );
}

function PspArt({ className }: { className?: string }): JSX.Element {
  return (
    <ArtSvg title="Sony PSP handheld console" className={className}>
      <Ground cx={120} cy={137} rx={105} />

      {/* Glossy wide handheld, with its display dominating the silhouette. */}
      <path
        d="M25 45c-9 2-15 11-15 21v35c0 11 7 19 17 21 19 4 38 7 57 8h72c19-1 38-4 57-8 10-2 17-10 17-21V66c0-10-6-19-15-21-26-6-52-9-78-9h-34c-26 0-52 3-78 9Z"
        fill={DARK}
      />
      <path d="M25 45c26-6 52-9 78-9h34c26 0 52 3 78 9" fill="none" stroke="rgba(255,255,255,.2)" />
      <rect x="58" y="47" width="124" height="70" rx="4" fill="rgba(0,0,0,.5)" />
      <rect x="64" y="53" width="112" height="58" rx="2" fill={ACCENT} opacity=".42" />
      <path d="M70 58h100v48H70Z" fill="rgba(0,0,0,.25)" />
      <Dpad x={35} y={75} size={24} fill={BODY} />
      <circle cx="204" cy="62" r="4.5" fill={BODY} />
      <circle cx="216" cy="75" r="4.5" fill={BODY} />
      <circle cx="204" cy="88" r="4.5" fill={BODY} />
      <circle cx="192" cy="75" r="4.5" fill={BODY} />
      <circle cx="36" cy="104" r="8" fill="rgba(255,255,255,.12)" />
      <circle cx="36" cy="104" r="4.5" fill={BODY} />
      <circle cx="204" cy="105" r="2" fill={ACCENT} />
      <circle cx="213" cy="105" r="2" fill="rgba(255,255,255,.25)" />
      <path d="M77 121h20M143 121h20" fill="none" stroke={SOFT_LINE} strokeWidth="2.5" />
      <rect x="105" y="120" width="30" height="4" rx="2" fill={BODY} />
      <circle cx="120" cy="122" r="1.2" fill={DARK} />
      <path d="M17 60c5-6 12-8 22-10M223 60c-5-6-12-8-22-10" fill="none" stroke={HIGHLIGHT} />
    </ArtSvg>
  );
}

function PcArt({ className }: { className?: string }): JSX.Element {
  return (
    <ArtSvg title="Gaming PC tower, monitor, keyboard, and mouse" className={className}>
      <Ground cx={122} cy={147} rx={106} />

      {/* Desktop monitor and pedestal. */}
      <rect x="15" y="24" width="137" height="90" rx="7" fill={DARK} />
      <rect x="23" y="32" width="121" height="69" rx="2" fill={ACCENT} opacity=".45" />
      <path d="M31 39h105v55H31Z" fill="rgba(0,0,0,.25)" />
      <path d="M31 87c19-18 37-15 49-5 15 13 33 7 56-17v29H31Z" fill={ACCENT} opacity=".42" stroke="none" />
      <circle cx="84" cy="107" r="2.2" fill={ACCENT} />
      <path d="M73 114h22l3 18H70Z" fill={DARK} />
      <path d="M60 132h49v7H60Z" fill={DARK} />
      <path d="M20 28h127" fill="none" stroke="rgba(255,255,255,.14)" />

      {/* Windowed tower with front fans and small lit controls. */}
      <path d="M164 19h59v119h-59Z" fill={DARK} />
      <path d="m164 19 7-6h55l-3 6Z" fill="rgba(255,255,255,.13)" />
      <path d="m223 19 3-6v119l-3 6Z" fill="rgba(0,0,0,.35)" />
      <rect x="171" y="29" width="39" height="67" rx="3" fill="rgba(255,255,255,.07)" />
      <circle cx="190.5" cy="49" r="14" fill="rgba(0,0,0,.25)" />
      <circle cx="190.5" cy="49" r="9" fill="none" stroke={ACCENT} strokeWidth="2.5" />
      <circle cx="190.5" cy="78" r="14" fill="rgba(0,0,0,.25)" />
      <circle cx="190.5" cy="78" r="9" fill="none" stroke={ACCENT} strokeWidth="2.5" />
      <path d="M181 49h19M190.5 39v20M181 78h19M190.5 68v20" fill="none" stroke={SOFT_LINE} />
      <circle cx="175" cy="108" r="3.3" fill={ACCENT} />
      <rect x="184" y="105" width="19" height="5" rx="2.5" fill="rgba(255,255,255,.12)" />
      <path d="M170 118h43M170 124h43M170 130h43" fill="none" stroke={SOFT_LINE} />

      {/* Just enough desk gear to say "PC library" rather than television. */}
      <path d="m21 129 96-1 10 14H13Z" fill={BODY} />
      <path d="M26 133h84M23 137h92" fill="none" stroke={SOFT_LINE} />
      <path d="M44 129v12M65 129v12M86 129v12M107 129v12" fill="none" stroke={SOFT_LINE} />
      <path d="M137 128c9 0 14 5 14 13h-27c0-8 5-13 13-13Z" fill={BODY} />
      <path d="M137 129v6" fill="none" stroke={ACCENT} />
    </ArtSvg>
  );
}

function GenericArt({ className }: { className?: string }): JSX.Element {
  return (
    <ArtSvg title="Generic game console and controller" className={className}>
      <Ground />

      <path d="m27 56 12-11h112l14 11 9 62H20Z" fill={BODY} />
      <path d="M39 45h112l14 11H27Z" fill={HIGHLIGHT} />
      <rect x="48" y="58" width="96" height="22" rx="5" fill={DARK} />
      <path d="M56 65h80M56 72h80" fill="none" stroke={SOFT_LINE} />
      <path d="M29 89h136" fill="none" stroke={SOFT_LINE} />
      <circle cx="43" cy="104" r="5" fill={ACCENT} />
      <circle cx="58" cy="104" r="5" fill={DARK} />
      <rect x="82" y="99" width="63" height="10" rx="3" fill="rgba(0,0,0,.2)" />
      <path d="M26 118v6h28v-6M142 118v6h28v-6" fill={DARK} />

      <path
        d="M144 100c-9 2-14 12-12 22l5 21c2 8 12 10 17 3l12-15h42l12 15c5 7 15 5 17-3l5-21c2-10-3-20-12-22-10-3-19 2-28 8h-30c-9-6-18-11-28-8Z"
        fill={DARK}
      />
      <path d="M138 112c11-7 21-5 31 1h36c10-6 20-8 31-1" fill="none" stroke="rgba(255,255,255,.12)" />
      <Dpad x={151} y={119} size={20} fill={BODY} />
      <circle cx="219" cy="111" r="4.2" fill={ACCENT} />
      <circle cx="228" cy="120" r="4.2" fill={ACCENT} />
      <circle cx="210" cy="120" r="4.2" fill={BODY} />
      <circle cx="219" cy="129" r="4.2" fill={BODY} />
      <rect x="177" y="118" width="9" height="3" rx="1.5" fill={BODY} />
      <rect x="190" y="118" width="9" height="3" rx="1.5" fill={BODY} />
    </ArtSvg>
  );
}

export function ConsoleArt(props: { id: string; className?: string }): JSX.Element {
  switch (props.id) {
    case 'nes':
      return <NesArt className={props.className} />;
    case 'snes':
      return <SnesArt className={props.className} />;
    case 'n64':
      return <N64Art className={props.className} />;
    case 'gamecube':
      return <GameCubeArt className={props.className} />;
    case 'wii':
      return <WiiArt className={props.className} />;
    case 'gb':
      return <GameBoyArt className={props.className} />;
    case 'genesis':
      return <GenesisArt className={props.className} />;
    case 'saturn':
      return <SaturnArt className={props.className} />;
    case 'dreamcast':
      return <DreamcastArt className={props.className} />;
    case 'ps1':
      return <Ps1Art className={props.className} />;
    case 'ps2':
      return <Ps2Art className={props.className} />;
    case 'psp':
      return <PspArt className={props.className} />;
    case 'pc':
      return <PcArt className={props.className} />;
    default:
      return <GenericArt className={props.className} />;
  }
}
