import { useMemo } from 'react';
import { generateQrMatrix } from './qrEncoder';
import './QrCode.css';

interface QrCodeProps {
  text: string;
}

/**
 * Renders `text` as an inline SVG QR code (see qrEncoder.ts — no npm dependency).
 * Falls back to the raw text if the encoder can't fit it in a version-5
 * symbol (106 bytes; no realistic LAN URL gets close), per CONTRACTS.md's
 * explicit fallback allowance.
 */
export function QrCode({ text }: QrCodeProps) {
  // The encoder is pure and fast (small matrices, no I/O) but there's no
  // reason to re-run it every render if `text` hasn't changed.
  const matrix = useMemo(() => generateQrMatrix(text), [text]);

  if (!matrix) {
    return <p className="qr-fallback">{text}</p>;
  }

  const size = matrix.length;
  const quiet = 4; // quiet-zone modules the spec requires around the symbol
  const dim = size + quiet * 2;

  // One <path> for every dark module, drawn as 1x1 unit squares — far fewer
  // DOM nodes than a <rect> per module, and just as crisp at any scale since
  // the viewBox is in module units.
  let cells = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) cells += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }

  return (
    <svg
      className="qr-svg"
      viewBox={`0 0 ${dim} ${dim}`}
      role="img"
      aria-label={`QR code linking to ${text}`}
      shapeRendering="crispEdges"
    >
      <rect className="qr-svg__quiet" width={dim} height={dim} />
      <path className="qr-svg__modules" d={cells} />
    </svg>
  );
}
