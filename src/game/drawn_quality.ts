// How finely the page draws its match right now, for the seat report
// (server/seat_report.ts, PRIVACY.md): the renderer in charge names
// itself the source while it draws (src/render/quality_dial.ts), and each
// answer to the server's round-trip probe reads it beside the frame rate
// (frame_rate.ts). A frame rate alone could not tell a laptop drawing two
// million pixels from one drawing a million at its floor (2026-10-05).

import type { DrawnQualityWire } from '../net/protocol';

let source: (() => DrawnQualityWire) | null = null;

// `from` reads the quality now; null when its renderer is gone. A renderer
// that goes clears only its own source.
export function reportQuality(
  from: (() => DrawnQualityWire) | null,
  owner?: () => DrawnQualityWire,
): void {
  if (from === null && owner !== undefined && source !== owner) return;
  source = from;
}

// The quality as the probe's echo carries it; null outside a match.
export function drawnQuality(): DrawnQualityWire | null {
  try {
    return source?.() ?? null;
  } catch {
    return null;
  }
}
