import type { PadArt, PadButton, PadLayout } from './pads';
import { PAD_VIEWBOX } from './pads';

/**
 * Controller line-art. Bodies are hand-drawn symmetric bezier silhouettes —
 * every path starts at top-center and mirrors its control points around
 * x=310, which is what keeps the shapes from going lumpy. Buttons stay
 * data-driven from pads.ts so art and focus targets share exact centres.
 */

interface ControllerDiagramProps {
  layout: PadLayout;
  activeButtonId?: string;
  listening?: boolean;
  className?: string;
  label: string;
}

/** Modern twin-grip silhouette (Xbox). Valley between the grips stays low so
 *  the d-pad and right stick sit comfortably inside the shell. */
function XboxBody() {
  return (
    <>
      {/* Traced from a front-on Xbox SERIES reference (Gold Shadow photo):
          smooth wide top arc with the guide just under it, widest at the
          sticks, gently flaring grips, shallow valley. */}
      <path
        className="pad-art__shell"
        d="M310 79
           C266 79 224 86 190 98
           C177 103 171 106 169 110
           C143 124 130 145 126 169
           C121 197 112 219 110 241
           C104 260 116 310 134 326
           C143 335 156 337 163 330
           C184 306 210 284 232 274
           C258 265 284 262 310 262
           C336 262 362 265 388 274
           C410 284 436 306 457 330
           C464 337 477 335 486 326
           C504 310 516 260 510 241
           C508 219 499 197 494 169
           C490 145 477 124 451 110
           C449 106 443 103 430 98
           C396 86 354 79 310 79 Z"
      />
      {/* The Series disc d-pad: a dished circle with cross grooves; the four
          direction targets render as arrows on top. */}
      <circle className="pad-art__well" cx="254" cy="185" r="30" />
      <path className="pad-art__detail" d="M254 161 V209 M230 185 H278" />
      {/* No seam: the Series face reads as one seamless surface from the front. */}
    </>
  );
}

/** SNES: the capsule "dog bone", face-button lens on the right. */
function SnesBody() {
  return (
    <>
      <path
        className="pad-art__shell"
        d="M160 100 H460 A95 95 0 0 1 460 290 H160 A95 95 0 0 1 160 100 Z"
      />
      <circle className="pad-art__well" cx="472" cy="181" r="58" />
      {/* The two 45°-recessed button slots: X/Y share one capsule, A/B the
          other — the SNES's most recognizable detail. */}
      <rect
        className="pad-art__slot"
        x="406"
        y="138"
        width="96"
        height="50"
        rx="25"
        transform="rotate(-45 454 163)"
      />
      <rect
        className="pad-art__slot"
        x="442"
        y="174"
        width="96"
        height="50"
        rx="25"
        transform="rotate(-45 490 199)"
      />
      <path className="pad-art__seam" d="M238 118 H382 M238 272 H382" />
    </>
  );
}

/** NES: the sharp brick with its striped top band. */
function NesBody() {
  return (
    <>
      <rect className="pad-art__shell" x="55" y="103" width="510" height="176" rx="10" />
      <rect className="pad-art__seam" x="74" y="120" width="472" height="142" rx="8" />
      <path className="pad-art__detail" d="M90 133 H545 M90 142 H545" />
    </>
  );
}

/** Genesis: wide winged oval, ABC arc bottom-right. */
function GenesisBody() {
  return (
    <>
      <path
        className="pad-art__shell"
        d="M157 99 C101 99 63 126 55 169 C48 209 70 257 113 277
           C148 293 182 276 213 250 C238 229 263 220 310 220
           C357 220 382 229 407 250 C438 276 472 293 507 277
           C550 257 572 209 565 169 C557 126 519 99 463 99
           C412 99 384 113 358 125 C330 138 290 138 262 125
           C236 113 208 99 157 99 Z"
      />
      <path className="pad-art__seam" d="M150 152 C220 118 400 118 470 152" />
    </>
  );
}

/** N64: the trident — two angled wings and a centre prong holding the stick. */
function N64Body() {
  return (
    <>
      <path
        className="pad-art__shell"
        d="M310 92
           C258 92 214 100 182 114
           C144 130 120 164 126 202
           C130 232 148 258 172 276
           C190 289 210 288 222 272
           L246 240
           C254 229 262 224 272 228
           C280 231 284 238 284 248
           L284 296
           C284 326 294 342 310 342
           C326 342 336 326 336 296
           L336 248
           C336 238 340 231 348 228
           C358 224 366 229 374 240
           L398 272
           C410 288 430 289 448 276
           C472 258 490 232 494 202
           C500 164 476 130 438 114
           C406 100 362 92 310 92 Z"
      />
      {/* Analog stick well at the trident's junction. */}
      <circle className="pad-art__well" cx="310" cy="236" r="36" />
      <path className="pad-art__detail" d="M310 208 V264 M282 236 H338" />
    </>
  );
}

/** Original PlayStation pad: long jet-wing grips, no sticks. */
function Ps1Body() {
  return (
    <>
      <path
        className="pad-art__shell"
        d="M310 100
           C282 100 260 104 242 110
           C214 100 184 104 168 124
           C150 146 138 186 136 222
           C134 262 150 292 178 296
           C202 299 218 282 230 262
           C242 242 258 234 278 236
           C292 238 302 239 310 239
           C318 239 328 238 342 236
           C362 234 378 242 390 262
           C402 282 418 299 442 296
           C470 292 486 262 484 222
           C482 186 470 146 452 124
           C436 104 406 100 378 110
           C360 104 338 100 310 100 Z"
      />
      <path className="pad-art__seam" d="M236 124 C260 136 360 136 384 124" />
      {/* D-pad circle bed — PS keeps four separate cross keys. */}
      <circle className="pad-art__well" cx="158" cy="189" r="46" />
    </>
  );
}

/** Game Boy: the brick, screen up top, heavy round bottom-right corner. */
function GameBoyBody() {
  return (
    <>
      <path
        className="pad-art__shell"
        d="M204 27 H416 C432 27 444 39 444 55 V292 C444 316 431 330 409 334
           L228 334 C195 334 176 316 176 282 V55 C176 39 188 27 204 27 Z"
      />
      <rect className="pad-art__screen-bezel" x="202" y="54" width="216" height="126" rx="10" />
      <rect className="pad-art__screen" x="238" y="70" width="144" height="94" rx="4" />
      <circle className="pad-art__detail" cx="218" cy="117" r="3.5" />
      <path className="pad-art__detail" d="M380 314 L410 306 M386 324 L416 316" />
    </>
  );
}

/** Generic fallback: a plain capsule pad. */
function GenericBody() {
  return (
    <>
      <path
        className="pad-art__shell"
        d="M170 108 H450 A88 88 0 0 1 450 284 H170 A88 88 0 0 1 170 108 Z"
      />
      <circle className="pad-art__well" cx="472" cy="181" r="56" />
    </>
  );
}

function BodyFor({ art }: { art: PadArt }) {
  switch (art) {
    case 'xbox':
      return <XboxBody />;
    case 'snes':
      return <SnesBody />;
    case 'nes':
      return <NesBody />;
    case 'genesis':
      return <GenesisBody />;
    case 'n64':
      return <N64Body />;
    case 'ps1':
      return <Ps1Body />;
    case 'gb':
      return <GameBoyBody />;
    case 'generic':
      return <GenericBody />;
  }
}

/**
 * One solid rounded plus derived from the four d-pad buttons' boxes, so the
 * cross always hugs the focus targets exactly. The individual direction
 * buttons render on top as etched arrows (their boxes go transparent in CSS)
 * — a d-pad is one object, not four floating tiles. PS pads override this
 * with separate cross keys via CSS.
 */
function DpadBed({ buttons }: { buttons: readonly PadButton[] }) {
  const up = buttons.find((b) => b.id === 'up');
  const down = buttons.find((b) => b.id === 'down');
  const left = buttons.find((b) => b.id === 'left');
  const right = buttons.find((b) => b.id === 'right');
  if (!up || !down || !left || !right) return null;

  const cx = (left.x + right.x) / 2;
  const cy = (up.y + down.y) / 2;
  const pad = 5;
  const r = 9;
  const wv = (up.width ?? 32) / 2 + pad; // vertical arm half-width
  const hh = (left.height ?? 32) / 2 + pad; // horizontal arm half-height
  const vTop = up.y - (up.height ?? 42) / 2 - pad;
  const vBottom = down.y + (down.height ?? 42) / 2 + pad;
  const hLeft = left.x - (left.width ?? 42) / 2 - pad;
  const hRight = right.x + (right.width ?? 42) / 2 + pad;

  const d = [
    `M${cx - wv} ${vTop + r}`,
    `Q${cx - wv} ${vTop} ${cx - wv + r} ${vTop}`,
    `H${cx + wv - r}`,
    `Q${cx + wv} ${vTop} ${cx + wv} ${vTop + r}`,
    `V${cy - hh}`,
    `H${hRight - r}`,
    `Q${hRight} ${cy - hh} ${hRight} ${cy - hh + r}`,
    `V${cy + hh - r}`,
    `Q${hRight} ${cy + hh} ${hRight - r} ${cy + hh}`,
    `H${cx + wv}`,
    `V${vBottom - r}`,
    `Q${cx + wv} ${vBottom} ${cx + wv - r} ${vBottom}`,
    `H${cx - wv + r}`,
    `Q${cx - wv} ${vBottom} ${cx - wv} ${vBottom - r}`,
    `V${cy + hh}`,
    `H${hLeft + r}`,
    `Q${hLeft} ${cy + hh} ${hLeft} ${cy + hh - r}`,
    `V${cy - hh + r}`,
    `Q${hLeft} ${cy - hh} ${hLeft + r} ${cy - hh}`,
    `H${cx - wv}`,
    'Z',
  ].join(' ');

  return (
    <>
      <path className="pad-art__dpad-bed" d={d} />
      <circle className="pad-art__detail" cx={cx} cy={cy} r="5" />
    </>
  );
}

function Control({
  button,
  active,
  listening,
}: {
  button: PadButton;
  active: boolean;
  listening: boolean;
}) {
  const width = button.width ?? 38;
  const height = button.height ?? width;
  const className = [
    'pad-control',
    `pad-control--${button.shape}`,
    active ? 'is-active' : '',
    active && listening ? 'is-listening' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <g className={className}>
      {button.shape === 'face' ? (
        <circle className="pad-control__shape" cx={button.x} cy={button.y} r={width / 2} />
      ) : button.shape === 'stick' ? (
        <>
          <circle className="pad-control__shape" cx={button.x} cy={button.y} r={width / 2} />
          <circle
            className="pad-control__stick-ring"
            cx={button.x}
            cy={button.y}
            r={width / 2 - 7}
          />
        </>
      ) : (
        <rect
          className="pad-control__shape"
          x={button.x - width / 2}
          y={button.y - height / 2}
          width={width}
          height={height}
          rx={button.shape === 'dpad' ? 7 : height / 2}
        />
      )}
      {button.label && (
        <text
          className={[
            'pad-control__label',
            button.label.length > 2 ? 'pad-control__label--small' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          x={button.x}
          y={button.y}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {button.label}
        </text>
      )}
    </g>
  );
}

export function ControllerDiagram({
  layout,
  activeButtonId,
  listening = false,
  className = '',
  label,
}: ControllerDiagramProps) {
  return (
    <svg
      className={`controller-diagram controller-diagram--${layout.art} ${className}`}
      viewBox={`0 0 ${PAD_VIEWBOX.width} ${PAD_VIEWBOX.height}`}
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <g className="pad-art">
        <BodyFor art={layout.art} />
        {/* Xbox draws its own disc d-pad in the body; a plus bed would fight it. */}
        {layout.art !== 'xbox' && <DpadBed buttons={layout.buttons} />}
      </g>
      <g className="pad-controls">
        {layout.buttons.map((button) => (
          <Control
            key={button.id}
            button={button}
            active={button.id === activeButtonId}
            listening={listening}
          />
        ))}
      </g>
    </svg>
  );
}
