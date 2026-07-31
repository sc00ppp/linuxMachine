/**
 * A tiny from-scratch QR code encoder — byte mode, error-correction level L,
 * versions 1-5 only (17/32/53/78/106 bytes capacity respectively). No npm
 * dependency (CONTRACTS.md forbids adding one); this is the ~150-line
 * encoder the contract calls for, sized for a LAN URL like
 * `http://192.168.1.42:5620/phone` which comfortably fits version 1-2.
 *
 * Versions 1-5 all use a single Reed-Solomon block at level L, which is what
 * keeps this short: no codeword interleaving across blocks. If the text is
 * too long to fit version 5 (106 bytes — far beyond any realistic LAN URL),
 * `generate` returns null and the caller falls back to plain text, exactly
 * as CONTRACTS.md allows.
 *
 * Implements ISO/IEC 18004 directly: GF(256) Reed-Solomon error correction,
 * the standard finder/timing/alignment/dark-module function patterns, the
 * BCH(15,5) format-info code, and the zigzag data placement with mask
 * pattern 0. Mask pattern 0 is used unconditionally rather than scored
 * against the other seven (the spec only requires *a* correctly-declared
 * mask, not the lowest-penalty one — scanners don't care, only human eyes
 * reading raw modules would).
 */

// ---------------------------------------------------------------------------
// GF(256) arithmetic (primitive polynomial 0x11D, the one QR uses).
// ---------------------------------------------------------------------------

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGaloisTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  // Duplicate the cycle so lookups can add exponents without a modulo.
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** Multiply two polynomials (coefficient arrays, highest degree first). */
function polyMul(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) out[i + j] ^= gfMul(a[i], b[j]);
  }
  return out;
}

/** Reed-Solomon generator polynomial: product of (x - alpha^i) for i in [0, eccLen). */
function rsGeneratorPoly(eccLen: number): number[] {
  let g = [1];
  for (let i = 0; i < eccLen; i++) g = polyMul(g, [1, GF_EXP[i]]);
  return g;
}

/** Polynomial long division remainder — the ECC codewords for one data block. */
function rsRemainder(data: Uint8Array, eccLen: number): number[] {
  const generator = rsGeneratorPoly(eccLen);
  const remainder = new Array(data.length + eccLen).fill(0);
  remainder.splice(0, data.length, ...data);
  for (let i = 0; i < data.length; i++) {
    const coef = remainder[i];
    if (coef === 0) continue;
    for (let j = 0; j < generator.length; j++) remainder[i + j] ^= gfMul(generator[j], coef);
  }
  return remainder.slice(data.length);
}

// ---------------------------------------------------------------------------
// Version table — level L, versions 1-5 (all single-block, byte mode).
// ---------------------------------------------------------------------------

interface VersionInfo {
  version: number;
  size: number;
  dataCodewords: number;
  eccCodewords: number;
  /** Center of the single non-corner alignment pattern; null for version 1. */
  alignCenter: number | null;
}

const VERSIONS: VersionInfo[] = [
  { version: 1, size: 21, dataCodewords: 19, eccCodewords: 7, alignCenter: null },
  { version: 2, size: 25, dataCodewords: 34, eccCodewords: 10, alignCenter: 18 },
  { version: 3, size: 29, dataCodewords: 55, eccCodewords: 15, alignCenter: 22 },
  { version: 4, size: 33, dataCodewords: 80, eccCodewords: 20, alignCenter: 26 },
  { version: 5, size: 37, dataCodewords: 108, eccCodewords: 26, alignCenter: 30 },
];

/** Byte-mode capacity = data codewords minus the mode+length header (12 bits ≈ 2 bytes). */
const capacityBytes = (v: VersionInfo): number => v.dataCodewords - 2;

// ---------------------------------------------------------------------------
// Bitstream: mode indicator + length + data, padded out to full codewords.
// ---------------------------------------------------------------------------

function buildDataCodewords(bytes: Uint8Array, info: VersionInfo): Uint8Array {
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, 8); // character count (8-bit indicator for versions 1-9)
  for (const b of bytes) push(b, 8);

  const capacityBits = info.dataCodewords * 8;
  const terminatorLen = Math.min(4, capacityBits - bits.length);
  for (let i = 0; i < terminatorLen; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }

  // Pad codewords alternate 0xEC/0x11 until the block is full (spec §7.4.10).
  const padBytes = [0xec, 0x11];
  for (let i = 0; codewords.length < info.dataCodewords; i++) {
    codewords.push(padBytes[i % 2]);
  }

  return Uint8Array.from(codewords);
}

// ---------------------------------------------------------------------------
// Matrix construction: function patterns, then zigzag data placement.
// ---------------------------------------------------------------------------

const isFinderDark = (r: number, c: number): boolean =>
  r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);

/**
 * Finder pattern + its 1-module separator, in one pass. The finder pattern
 * is rotationally symmetric, so a single template works for all three
 * corners — only the anchor (top-left of the 7x7 block) differs. Looping
 * r/c over [-1, 7] paints the separator ring (light) and lets it fall off
 * the matrix naturally for the sides that are already the symbol's edge.
 */
function placeFinder(
  matrix: boolean[][],
  reserved: boolean[][],
  size: number,
  anchorRow: number,
  anchorCol: number,
): void {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const row = anchorRow + r;
      const col = anchorCol + c;
      if (row < 0 || row >= size || col < 0 || col >= size) continue;
      reserved[row][col] = true;
      const inFinder = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      matrix[row][col] = inFinder && isFinderDark(r, c);
    }
  }
}

function placeAlignment(matrix: boolean[][], reserved: boolean[][], center: number): void {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const row = center + r;
      const col = center + c;
      reserved[row][col] = true;
      matrix[row][col] = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
    }
  }
}

function placeTiming(matrix: boolean[][], reserved: boolean[][], size: number): void {
  for (let i = 8; i <= size - 9; i++) {
    const dark = i % 2 === 0;
    if (!reserved[6][i]) {
      matrix[6][i] = dark;
      reserved[6][i] = true;
    }
    if (!reserved[i][6]) {
      matrix[i][6] = dark;
      reserved[i][6] = true;
    }
  }
}

/**
 * Module coordinates for the two redundant copies of the 15-bit format info
 * string, in MSB-first order (ISO/IEC 18004 §7.9, figure 25). Copy 2 spans
 * two corners so at least one copy survives if a corner is obscured.
 */
function formatInfoPositions(size: number): { copyA: [number, number][]; copyB: [number, number][] } {
  const copyA: [number, number][] = [
    ...Array.from({ length: 6 }, (_, i): [number, number] => [8, i]),
    [8, 7],
    [8, 8],
    [7, 8],
    ...Array.from({ length: 6 }, (_, i): [number, number] => [5 - i, 8]),
  ];
  const copyB: [number, number][] = [
    ...Array.from({ length: 7 }, (_, i): [number, number] => [size - 1 - i, 8]),
    ...Array.from({ length: 8 }, (_, i): [number, number] => [8, size - 8 + i]),
  ];
  return { copyA, copyB };
}

/** BCH(15,5) format info: EC level L (`01`) + 3-bit mask id, then XOR the fixed mask. */
function computeFormatBits(maskId: number): number[] {
  const data5 = (0b01 << 3) | maskId;
  const GENERATOR = 0b10100110111; // degree-10 generator poly for format info
  let rem = data5 << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= GENERATOR << (i - 10);
  }
  const combined = ((data5 << 10) | rem) ^ 0b101010000010010;
  return Array.from({ length: 15 }, (_, i) => (combined >> (14 - i)) & 1);
}

const maskBit = (row: number, col: number): number => ((row + col) % 2 === 0 ? 1 : 0);

/** Zigzag placement (spec §7.7.3): columns right-to-left in pairs, skipping column 6. */
function placeData(matrix: boolean[][], reserved: boolean[][], size: number, codewords: Uint8Array): void {
  const bitAt = (index: number): number => {
    const byteIndex = index >> 3;
    if (byteIndex >= codewords.length) return 0;
    return (codewords[byteIndex] >> (7 - (index & 7))) & 1;
  };

  let bitIndex = 0;
  let col = size - 1;
  let upward = true;

  while (col > 0) {
    if (col === 6) col -= 1; // the timing column doesn't exist for this walk
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let offset = 0; offset < 2; offset++) {
        const c = col - offset;
        if (reserved[row][c]) continue;
        const bit = bitAt(bitIndex++);
        matrix[row][c] = (bit ^ maskBit(row, c)) === 1;
      }
    }
    upward = !upward;
    col -= 2;
  }
}

/** Full boolean matrix for one version, mask pattern 0 fixed. */
function renderMatrix(info: VersionInfo, codewords: Uint8Array): boolean[][] {
  const { size } = info;
  const matrix: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));

  placeFinder(matrix, reserved, size, 0, 0);
  placeFinder(matrix, reserved, size, 0, size - 7);
  placeFinder(matrix, reserved, size, size - 7, 0);
  if (info.alignCenter !== null) placeAlignment(matrix, reserved, info.alignCenter);
  placeTiming(matrix, reserved, size);

  // Dark module — always present, always here (spec §6.9).
  const darkRow = 4 * info.version + 9;
  matrix[darkRow][8] = true;
  reserved[darkRow][8] = true;

  const { copyA, copyB } = formatInfoPositions(size);
  for (const [row, col] of [...copyA, ...copyB]) reserved[row][col] = true;

  placeData(matrix, reserved, size, codewords);

  const formatBits = computeFormatBits(0);
  for (let i = 0; i < 15; i++) {
    const [rowA, colA] = copyA[i];
    const [rowB, colB] = copyB[i];
    matrix[rowA][colA] = formatBits[i] === 1;
    matrix[rowB][colB] = formatBits[i] === 1;
  }

  return matrix;
}

/**
 * Encode `text` as a QR symbol. Returns null if it doesn't fit version 5
 * (106 bytes) — callers should fall back to showing the URL as plain text,
 * per CONTRACTS.md's explicit escape hatch.
 */
export function generateQrMatrix(text: string): boolean[][] | null {
  const bytes = new TextEncoder().encode(text);
  const info = VERSIONS.find((v) => bytes.length <= capacityBytes(v));
  if (!info) return null;

  const dataCodewords = buildDataCodewords(bytes, info);
  const eccCodewords = rsRemainder(dataCodewords, info.eccCodewords);
  const allCodewords = Uint8Array.from([...dataCodewords, ...eccCodewords]);

  return renderMatrix(info, allCodewords);
}
