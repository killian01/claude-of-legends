// Where the replay bar sits, as arithmetic.
//
// It used to sit at a fixed height off the bottom, which was a guess
// about how tall the HUD is: on a real match it landed straight on the
// champion's health, mana and gold (playtest). The bar is the replay's
// main control and the HUD under it is what a viewer is watching, so
// neither may cover the other, and neither may be moved for the other.
//
// So the default is measured, not guessed: just above whatever the HUD's
// bottom block actually occupies. And because no default fits every
// screen, the bar can be dragged anywhere and collapsed to its handle,
// with the choice remembered. Dragged out of reach, it is clamped back
// on the next open: a control nobody can find again is worse than one
// in the way.
//
// Pure arithmetic, no DOM: src/ui/replay_bar.ts owns the elements.

export interface Placement {
  // Distance from the container's left and top edges, in px.
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

// The stored choice: a position when the viewer has moved the bar, and
// whether they collapsed it. Either half may be absent.
export interface BarPrefs {
  at?: Placement;
  collapsed?: boolean;
}

// How far above the HUD the bar rides when it has not been moved: enough
// to read as its own thing rather than another row of the HUD.
export const DOCK_GAP = 18;
// The bar never goes closer than this to an edge, wherever it is put.
export const EDGE_MARGIN = 8;

// The default: clear of the HUD's bottom block, in px from the bottom.
// A HUD that is not there (a spectator's view, a test) falls back to the
// gap alone, which is the bottom edge plus a breath.
export function dockedBottom(hudHeight: number): number {
  return Math.max(0, Math.round(hudHeight)) + DOCK_GAP;
}

// A stored position brought back inside a viewport that may have changed
// size since (a smaller window, a rotated phone). Never off any edge, and
// never past the far edge for a bar wider than the view.
export function clampToView(at: Placement, bar: Size, view: Size): Placement {
  const maxX = Math.max(EDGE_MARGIN, view.w - bar.w - EDGE_MARGIN);
  const maxY = Math.max(EDGE_MARGIN, view.h - bar.h - EDGE_MARGIN);
  return {
    x: Math.min(maxX, Math.max(EDGE_MARGIN, Math.round(at.x))),
    y: Math.min(maxY, Math.max(EDGE_MARGIN, Math.round(at.y))),
  };
}

// The prefs as they come back from storage: anything malformed reads as
// no preference at all, because a broken line in localStorage must not
// cost the viewer their controls.
export function readPrefs(raw: string | null): BarPrefs {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as BarPrefs;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: BarPrefs = {};
    const at = parsed.at;
    if (typeof at === 'object' && at !== null && Number.isFinite(at.x) && Number.isFinite(at.y)) {
      out.at = { x: at.x, y: at.y };
    }
    if (typeof parsed.collapsed === 'boolean') out.collapsed = parsed.collapsed;
    return out;
  } catch {
    return {};
  }
}

export function writePrefs(prefs: BarPrefs): string {
  return JSON.stringify(prefs);
}
