// Keeps the mouse on the game in fullscreen (the maintainer: with two
// monitors a click past the edge landed on the other screen mid-fight).
// No browser confines a visible cursor to a window, so the cursor is
// locked instead (the browser hides it and reports movement only) and the
// game draws its own: a virtual position moved by the deltas and clamped
// to the window, the game's painted cursor at it (the dart and the sword,
// read off the CSS cursor under it), and every pointer event re-dispatched
// at that position to whatever stands there, so the ground, the HUD and
// the minimap keep their handlers unchanged. Native pointer events carry
// frozen coordinates while locked and are stopped before anyone reads
// them; Firefox gives the re-dispatched ones the same frozen coordinates,
// so each carries the virtual point on itself (pinPoint). What a browser
// does for a real pointer, the lock does by hand:
// the enter and leave pairs along the ancestors, :hover (the elements
// under the virtual cursor get a `vhover` class, and every :hover rule of
// the page's stylesheets is copied onto it), a click at the press and the
// release's common ancestor, the right press's contextmenu (Firefox sends
// none while locked), the wheel scrolling the list under it. What
// it cannot do (drag a slider, open a select's list, capture the pointer,
// which a browser refuses while it is locked) is why the cursor is let go
// while the pause menu or the end screen stands (setFree), and never
// locked for a replay. Esc leaves the lock at the browser's
// discretion; the next click inside re-locks while fullscreen holds.
// Touch devices and browsers without pointer lock are left alone, and a
// touch on a touchscreen laptop goes where the finger is.

import { wheelDeltas } from './wheel_step';

export interface Point {
  x: number;
  y: number;
}

// The virtual cursor never leaves the window: that is the whole point.
export function clampToViewport(x: number, y: number, width: number, height: number): Point {
  return {
    x: Math.min(Math.max(0, x), Math.max(0, width - 1)),
    y: Math.min(Math.max(0, y), Math.max(0, height - 1)),
  };
}

export interface CursorImage {
  url: string;
  hotX: number;
  hotY: number;
}

// A CSS cursor value's painted image and hotspot ("url(data:...) 3 1,
// auto"), null for a keyword cursor.
export function cursorImageOf(css: string): CursorImage | null {
  const m = /url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)\s*(-?\d+(?:\.\d+)?)?\s*(-?\d+(?:\.\d+)?)?/.exec(
    css,
  );
  if (!m) return null;
  const url = m[1] ?? m[2] ?? m[3] ?? '';
  if (!url) return null;
  return { url, hotX: Number(m[4] ?? 0), hotY: Number(m[5] ?? 0) };
}

// The movement a locked pointer reports is in the browser's units, not
// the page's: Firefox counts CSS pixels, what clientX counts in, but
// Chromium has counted the screen's physical pixels (w3c/pointerlock#42),
// so on a screen scaled to 150% or a page zoomed in, the painted cursor
// ran ahead of the hand by that much. The factor that turns the one into
// the other is measured while the cursor is free, from the page's first
// moves (measureMovement), off moves that carry both a movement and a
// client position. Until there is enough of it the movement is taken as
// it comes, as it always was.
export interface MovementScale {
  // One free move: its movement, and how far its client point went since
  // the previous one.
  sample(movementX: number, movementY: number, clientDX: number, clientDY: number): void;
  // The factor from a reported movement to CSS pixels.
  factor(devicePixelRatio: number): number;
}

// Below this much measured movement, the guess stands.
const MEASURED_ENOUGH_PX = 400;
// A single move this long is a jump (the pointer coming back into the
// window, a driver's spike), not the hand: left out of the measure.
const MOVE_JUMP_PX = 150;
// The measure keeps its recent past only, so a window carried to a
// screen of another scale is measured again.
const MEASURE_SPAN_PX = 8000;
// A measure this close to a known factor is that factor.
const SNAP = 0.08;

export function createMovementScale(): MovementScale {
  let moved = 0;
  let went = 0;
  return {
    sample(movementX, movementY, clientDX, clientDY) {
      const m = Math.abs(movementX) + Math.abs(movementY);
      const d = Math.abs(clientDX) + Math.abs(clientDY);
      if (!(m > 0) || m > MOVE_JUMP_PX || !(d >= 0) || d > MOVE_JUMP_PX * 4) return;
      moved += m;
      went += d;
      if (moved > MEASURE_SPAN_PX) {
        moved /= 2;
        went /= 2;
      }
    },
    factor(devicePixelRatio) {
      const ratio =
        devicePixelRatio > 0 && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
      if (moved < MEASURED_ENOUGH_PX) return 1;
      const measured = went / moved;
      for (const known of [1, 1 / ratio]) {
        if (Math.abs(measured / known - 1) <= SNAP) return known;
      }
      return Math.min(4, Math.max(0.25, measured));
    },
  };
}

// The elements a move leaves and enters, the way a browser fires the
// leave and enter events: every element of the old chain the new one does
// not hold, deepest first, then every one of the new chain the old one
// did not hold, outermost first. A chain runs from the element under the
// cursor up through its ancestors, so a tooltip on a slot shows over the
// slot's key label as it does under a real pointer.
export function hoverChange<T>(from: readonly T[], to: readonly T[]): { left: T[]; entered: T[] } {
  const stays = new Set(to);
  const was = new Set(from);
  return {
    left: from.filter((n) => !stays.has(n)),
    entered: to.filter((n) => !was.has(n)).reverse(),
  };
}

// Where a click lands when the press and the release stood on different
// elements: their nearest common ancestor, as a browser has it, so a
// press on the ground released over a button does not press the button.
export function commonAncestor<T extends { parentElement: T | null }>(a: T, b: T): T | null {
  const above = new Set<T>();
  for (let n: T | null = a; n; n = n.parentElement) above.add(n);
  for (let n: T | null = b; n; n = n.parentElement) if (above.has(n)) return n;
  return null;
}

// A rule's selector with :hover read as the class the virtual cursor
// gives, null when it names no :hover.
export function vhoverSelector(selector: string): string | null {
  if (!selector.includes(':hover')) return null;
  const out = selector.replace(/:hover(?![\w-])/g, '.vhover');
  return out === selector ? null : out;
}

// The slice of the CSS object model the copy reads: a style rule, or an
// @media block of them.
export interface HoverRuleSource {
  selectorText?: string;
  style?: { cssText: string };
  media?: { mediaText: string };
  cssRules?: ArrayLike<HoverRuleSource>;
}

// Every :hover rule of a sheet again, on the `vhover` class, in the
// sheet's order, an @media block kept around its own.
export function vhoverRules(rules: ArrayLike<HoverRuleSource>): string[] {
  const out: string[] = [];
  for (const rule of Array.from(rules)) {
    if (typeof rule.selectorText === 'string' && rule.style) {
      const selector = vhoverSelector(rule.selectorText);
      if (selector) out.push(`${selector} { ${rule.style.cssText} }`);
    } else if (rule.media && rule.cssRules) {
      const inner = vhoverRules(rule.cssRules);
      if (inner.length > 0) out.push(`@media ${rule.media.mediaText} { ${inner.join(' ')} }`);
    }
  }
  return out;
}

// A wheel's turn in pixels for the list the lock scrolls by hand: a wheel
// can count in lines or pages, and the scroll counts in pixels. A line is
// a line of text here; the zoom's own count (game/wheel_step.ts) makes
// three lines a pixel wheel's notch instead.
export const WHEEL_LINE_PX = 20;
export function wheelPixels(delta: number, mode: number, page: number): number {
  if (mode === 1) return delta * WHEEL_LINE_PX;
  if (mode === 2) return delta * page;
  return delta;
}

export interface ScrollBox {
  overflowX: string;
  overflowY: string;
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
}

const SCROLLING = /^(auto|scroll|overlay)$/;

// Whether a box scrolls by a wheel's turn: it lets its content scroll and
// still has room that way. The wheel scrolls the nearest box under the
// cursor that does, as a browser's own scroll passes a list's end on to
// the panel around it.
export function scrollsBy(box: ScrollBox, dx: number, dy: number): boolean {
  if (dy !== 0 && SCROLLING.test(box.overflowY) && box.scrollHeight > box.clientHeight) {
    if (dy < 0 ? box.scrollTop > 0 : box.scrollTop + box.clientHeight < box.scrollHeight - 1) {
      return true;
    }
  }
  if (dx !== 0 && SCROLLING.test(box.overflowX) && box.scrollWidth > box.clientWidth) {
    if (dx < 0 ? box.scrollLeft > 0 : box.scrollLeft + box.clientWidth < box.scrollWidth - 1) {
      return true;
    }
  }
  return false;
}

// The events a locked pointer must not let through with frozen
// coordinates: movement, buttons, and the hover pairs the game makes
// itself.
const SWALLOWED: readonly string[] = [
  'pointermove',
  'mousemove',
  'pointerdown',
  'mousedown',
  'pointerup',
  'mouseup',
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
  'pointerover',
  'pointerout',
  'pointerenter',
  'pointerleave',
  'mouseover',
  'mouseout',
  'mouseenter',
  'mouseleave',
  'wheel',
];

// The arrow drawn when the element under the cursor names no image.
const FALLBACK_ARROW =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="24" viewBox="0 0 20 24">' +
      '<path d="M2 1 L2 19 L7 14.5 L10.5 22 L14 20.5 L10.5 13 L17 13 Z" fill="#dfe9f5" stroke="#1b2330" stroke-width="1.5" stroke-linejoin="round"/>' +
      '</svg>',
  );

// Two free moves further apart than this do not measure the movement:
// the pointer left the window or the page between them.
const SAMPLE_GAP_MS = 100;

// One measure per page, kept from its first moves across every match.
const scales = new WeakMap<object, MovementScale>();

function scaleOf(win: object): MovementScale {
  let scale = scales.get(win);
  if (!scale) {
    scale = createMovementScale();
    scales.set(win, scale);
  }
  return scale;
}

// Starts measuring the mouse's movement against its client point on this
// page, while the cursor is free (the menus, champion select), so the
// first match's locked cursor already moves at the hand's pace. Once per
// page; the listener stays for the page's life.
export function measureMovement(win: Window = window): void {
  if (scales.has(win)) return;
  const scale = scaleOf(win);
  let last: { x: number; y: number; at: number } | null = null;
  win.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse' || win.document.pointerLockElement) {
        last = null;
        return;
      }
      const at = e.timeStamp;
      if (last && at >= last.at && at - last.at < SAMPLE_GAP_MS) {
        scale.sample(e.movementX, e.movementY, e.clientX - last.x, e.clientY - last.y);
      }
      last = { x: e.clientX, y: e.clientY, at };
    },
    { passive: true },
  );
}

// What a mouse event says about the hand behind it: a finger or a pen
// goes where it touches, never to the virtual cursor.
function fromTouchOrPen(e: Event): boolean {
  const p = e as Event & {
    pointerType?: string;
    sourceCapabilities?: { firesTouchEvents?: boolean } | null;
    mozInputSource?: number;
  };
  if (typeof p.pointerType === 'string' && p.pointerType !== '' && p.pointerType !== 'mouse') {
    return true;
  }
  if (p.sourceCapabilities?.firesTouchEvents === true) return true;
  // Firefox's MOZ_SOURCE_TOUCH and MOZ_SOURCE_PEN.
  return p.mozInputSource === 5 || p.mozInputSource === 2;
}

export interface CursorLock {
  // True lets the cursor go (and keeps it free); false takes it back
  // while fullscreen holds. For what stands over the match and needs the
  // browser's own pointer: the pause menu's sliders and lists, the end
  // screen. A no-op when it does not change.
  setFree(free: boolean): void;
  dispose(): void;
}

const INERT: CursorLock = { setFree: () => undefined, dispose: () => undefined };

type WindowWithEvents = Window & {
  PointerEvent?: typeof PointerEvent;
  MouseEvent: typeof MouseEvent;
  WheelEvent: typeof WheelEvent;
};

export function installCursorLock(root: HTMLElement, doc: Document = document): CursorLock {
  const win = doc.defaultView as WindowWithEvents | null;
  if (!win || typeof root.requestPointerLock !== 'function') return INERT;
  if (typeof win.PointerEvent !== 'function') return INERT;
  if (typeof win.matchMedia === 'function' && !win.matchMedia('(pointer: fine)').matches) {
    return INERT;
  }
  const PointerEv = win.PointerEvent;

  measureMovement(win);
  const movement = scaleOf(win);

  const synthetic = new WeakSet<Event>();
  let locked = false;
  let free = false;
  let vx = win.innerWidth / 2;
  let vy = win.innerHeight / 2;
  // The element under the virtual cursor, and its chain to the root.
  let hovered: Element | null = null;
  let chain: Element[] = [];
  // The mouse's pointerId as this browser numbers it (1 in Chromium, 0 in
  // Firefox): the synthetic events carry the real pointer's.
  let pointerId = 1;
  // Where the buttons went down, for the click's target.
  let pressedOn: Element | null = null;
  // A press whose pointerdown a handler canceled sends no mouse events
  // until the release, as a browser has it.
  let mouseQuiet = false;
  // Which of the browser's moves carries the movement: the pointer's,
  // which keep coming while a button is held over a canceled press, or
  // the mouse's, for an engine whose pointer moves report none. Settled
  // by the first that moves.
  let moveSource: 'pointermove' | 'mousemove' | null = null;

  const cursor = doc.createElement('div');
  cursor.className = 'cursor-lock';
  cursor.style.cssText =
    'position:fixed;left:0;top:0;width:32px;height:32px;pointer-events:none;' +
    'z-index:100000;display:none;background-repeat:no-repeat;background-size:contain;';
  doc.body.appendChild(cursor);

  // The page's :hover rules on the `vhover` class, built when the lock
  // takes and again whenever a stylesheet has come or gone since.
  const mirror = doc.createElement('style');
  mirror.dataset.cursorLock = 'hover';
  let mirroredSheets = -1;
  const mirrorHover = (): void => {
    const sheets = doc.styleSheets;
    if (!sheets || sheets.length === mirroredSheets) return;
    const rules: string[] = [];
    for (const sheet of Array.from(sheets)) {
      if (sheet.ownerNode === mirror) continue;
      try {
        rules.push(...vhoverRules(sheet.cssRules as unknown as ArrayLike<HoverRuleSource>));
      } catch {
        // A sheet from another origin cannot be read; the game's are
        // all its own.
      }
    }
    mirror.textContent = rules.join('\n');
    if (!mirror.isConnected) doc.head.appendChild(mirror);
    mirroredSheets = doc.styleSheets.length;
  };

  const paintCursor = (): void => {
    const style = hovered ? win.getComputedStyle(hovered).cursor : '';
    const image = cursorImageOf(style);
    cursor.style.backgroundImage = `url("${image ? image.url : FALLBACK_ARROW}")`;
    const hotX = image ? image.hotX : 2;
    const hotY = image ? image.hotY : 1;
    // On whole device pixels, so the painting stays sharp.
    const dpr = win.devicePixelRatio > 0 ? win.devicePixelRatio : 1;
    const x = Math.round((vx - hotX) * dpr) / dpr;
    const y = Math.round((vy - hotY) * dpr) / dpr;
    cursor.style.transform = `translate(${x}px, ${y}px)`;
  };

  const init = (
    native: MouseEvent,
    extra: { related?: Element | null; dx?: number; dy?: number } = {},
  ): PointerEventInit => ({
    bubbles: true,
    cancelable: true,
    composed: true,
    view: win,
    detail: native.detail,
    clientX: vx,
    clientY: vy,
    screenX: vx,
    screenY: vy,
    movementX: extra.dx ?? 0,
    movementY: extra.dy ?? 0,
    relatedTarget: extra.related ?? null,
    button: native.button,
    buttons: native.buttons,
    ctrlKey: native.ctrlKey,
    shiftKey: native.shiftKey,
    altKey: native.altKey,
    metaKey: native.metaKey,
    pointerId,
    pointerType: 'mouse',
    isPrimary: true,
    width: 1,
    height: 1,
    pressure: native.buttons ? 0.5 : 0,
  });

  // Firefox reads every mouse event's point off the lock while the pointer
  // is locked, the page's own events too: Gecko's Event::GetClientCoords
  // hands back the point where the lock took, whatever the event was made
  // with. Each synthetic event then said that one frozen point, and every
  // click on the ground ordered the same walk, a click on the champion
  // included. The virtual point is written on the event itself, which
  // stands before the browser's getters. offsetX and layerX are not
  // written and stay frozen on Firefox: the match reads clientX.
  const pinPoint = (ev: Event): void => {
    const x = vx;
    const y = vy;
    Object.defineProperties(ev, {
      clientX: { value: x },
      clientY: { value: y },
      x: { value: x },
      y: { value: y },
      screenX: { value: x },
      screenY: { value: y },
      // Read when asked only: the scroll costs Chromium a layout.
      pageX: { get: () => x + (win.scrollX || 0) },
      pageY: { get: () => y + (win.scrollY || 0) },
    });
  };

  // Dispatches one synthetic event; true unless a handler canceled it.
  const forward = (
    type: string,
    native: MouseEvent,
    target: Element,
    extra: { related?: Element | null; dx?: number; dy?: number; bubbles?: boolean } = {},
  ): boolean => {
    const detail = { ...init(native, extra), bubbles: extra.bubbles ?? true };
    const ev = type.startsWith('pointer')
      ? new PointerEv(type, detail)
      : new win.MouseEvent(type, detail);
    pinPoint(ev);
    synthetic.add(ev);
    return target.dispatchEvent(ev);
  };

  const chainOf = (el: Element | null): Element[] => {
    const out: Element[] = [];
    for (let n = el; n; n = n.parentElement) out.push(n);
    return out;
  };

  const setHoverClass = (left: readonly Element[], entered: readonly Element[]): void => {
    for (const n of left) n.classList.remove('vhover');
    for (const n of entered) n.classList.add('vhover');
  };

  // The element under the virtual cursor changed: the out and over pairs
  // at the deepest, the leave and enter events along the chains.
  const hoverTo = (under: Element | null, native: MouseEvent): void => {
    if (under === hovered) return;
    const was = hovered;
    const next = chainOf(under);
    const { left, entered } = hoverChange(chain, next);
    if (was) {
      forward('pointerout', native, was, { related: under });
      for (const n of left) forward('pointerleave', native, n, { related: under, bubbles: false });
      forward('mouseout', native, was, { related: under });
      for (const n of left) forward('mouseleave', native, n, { related: under, bubbles: false });
    }
    mirrorHover();
    setHoverClass(left, entered);
    hovered = under;
    chain = next;
    if (under) {
      forward('pointerover', native, under, { related: was });
      for (const n of entered) forward('pointerenter', native, n, { related: was, bubbles: false });
      forward('mouseover', native, under, { related: was });
      for (const n of entered) forward('mouseenter', native, n, { related: was, bubbles: false });
    }
  };

  const clearHover = (): void => {
    setHoverClass(chain, []);
    hovered = null;
    chain = [];
  };

  const targetAt = (): Element | null => doc.elementFromPoint(vx, vy);

  const moveBy = (native: MouseEvent): void => {
    const k = movement.factor(win.devicePixelRatio);
    const dx = native.movementX * k;
    const dy = native.movementY * k;
    const p = clampToViewport(vx + dx, vy + dy, win.innerWidth, win.innerHeight);
    vx = p.x;
    vy = p.y;
    const under = targetAt();
    hoverTo(under, native);
    if (under) {
      forward('pointermove', native, under, { dx, dy });
      if (!mouseQuiet) forward('mousemove', native, under, { dx, dy });
    }
    paintCursor();
  };

  const scrollFrom = (from: Element, dx: number, dy: number): void => {
    for (let n: Element | null = from; n && n !== doc.body; n = n.parentElement) {
      if (n === doc.documentElement) return;
      const cs = win.getComputedStyle(n);
      const box: ScrollBox = {
        overflowX: cs.overflowX,
        overflowY: cs.overflowY,
        scrollLeft: n.scrollLeft,
        scrollTop: n.scrollTop,
        scrollWidth: n.scrollWidth,
        scrollHeight: n.scrollHeight,
        clientWidth: n.clientWidth,
        clientHeight: n.clientHeight,
      };
      if (scrollsBy(box, dx, dy)) {
        n.scrollBy({ left: dx, top: dy });
        return;
      }
    }
  };

  const onWheel = (w: WheelEvent): void => {
    const target = targetAt();
    if (!target) return;
    // The mode is read before the deltas (game/wheel_step.ts): Firefox
    // then keeps a notch in its three lines, which the zoom counts as a
    // pixel wheel's notch, so a notch zooms as far locked as free.
    const { deltaMode, deltaX, deltaY, deltaZ } = wheelDeltas(w);
    const ev = new win.WheelEvent('wheel', { ...init(w), deltaX, deltaY, deltaZ, deltaMode });
    pinPoint(ev);
    synthetic.add(ev);
    const go = target.dispatchEvent(ev);
    // Ctrl and the wheel zoom the page, the browser's own to do.
    if (go && w.ctrlKey) return;
    w.preventDefault();
    if (!go) return;
    // A synthetic wheel scrolls nothing by itself: the list under the
    // cursor is scrolled by hand.
    scrollFrom(
      target,
      wheelPixels(deltaX, deltaMode, win.innerWidth),
      wheelPixels(deltaY, deltaMode, win.innerHeight),
    );
  };

  const onButton = (e: MouseEvent): void => {
    // The browser's own menu and focus changes follow the frozen point;
    // the synthetic event carries the real one.
    e.preventDefault();
    const type = e.type;
    // The mouse's own press and release: made from the pointer's below.
    // The menu as well: Gecko refuses a contextmenu while the pointer is
    // locked (EventStateManager::PreHandleEvent), so on Firefox none came
    // and a right-click on an inventory slot sold nothing. It is made from
    // the right press, where the cursor is, and a browser's own dropped.
    if (type === 'mousedown' || type === 'mouseup' || type === 'contextmenu') return;
    const under = targetAt();
    if (type === 'pointerdown') {
      if (!under) return;
      pressedOn = under;
      mouseQuiet = !forward('pointerdown', e, under);
      if (!mouseQuiet) forward('mousedown', e, under);
      if (e.button === 2) forward('contextmenu', e, under);
      return;
    }
    if (type === 'pointerup') {
      if (under) {
        forward('pointerup', e, under);
        if (!mouseQuiet) forward('mouseup', e, under);
      }
      if (e.buttons === 0) mouseQuiet = false;
      return;
    }
    // click, dblclick, auxclick: at the common ancestor of where the press
    // and the release stood.
    if (!under) return;
    const target = pressedOn ? (commonAncestor(pressedOn, under) ?? under) : under;
    forward(type, e, target);
    if (type === 'click' && target === under) {
      const tag = target.tagName;
      if ((tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') && 'focus' in target) {
        (target as HTMLElement).focus();
      }
    }
  };

  const onNative = (e: Event): void => {
    // A locked pointer's events all go to the locked element: anything
    // else (a key's click on a focused button, a handler's el.click(), a
    // finger on a touchscreen laptop) goes where it was sent.
    if (!locked || !e.isTrusted || e.target !== root || synthetic.has(e)) return;
    if (fromTouchOrPen(e)) return;
    e.stopImmediatePropagation();
    const pe = e as PointerEvent;
    if (e.type.startsWith('pointer') && typeof pe.pointerId === 'number') pointerId = pe.pointerId;
    if (e.type === 'pointermove' || e.type === 'mousemove') {
      // The pointer's moves drive the cursor rather than the mouse's: a
      // browser sends no mousemove while a button is held over a canceled
      // pointerdown, and every press here is canceled.
      const m = e as MouseEvent;
      if (moveSource === null && (m.movementX !== 0 || m.movementY !== 0)) moveSource = e.type;
      if (e.type === moveSource) moveBy(m);
      return;
    }
    if (e.type === 'wheel') {
      onWheel(e as WheelEvent);
      return;
    }
    if (
      e.type === 'pointerdown' ||
      e.type === 'pointerup' ||
      e.type === 'mousedown' ||
      e.type === 'mouseup' ||
      e.type === 'click' ||
      e.type === 'dblclick' ||
      e.type === 'auxclick' ||
      e.type === 'contextmenu'
    ) {
      onButton(e as MouseEvent);
    }
    // The hover pairs the browser fires at the frozen point are dropped;
    // moveBy makes the game's own.
  };

  const tryLock = (): void => {
    if (free || locked || !doc.fullscreenElement || doc.pointerLockElement) return;
    try {
      const r = root.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => undefined);
    } catch {
      // A browser that refuses the lock leaves the cursor free.
    }
  };

  const unlock = (): void => {
    if (doc.pointerLockElement === root) doc.exitPointerLock();
  };

  const onLockChange = (): void => {
    const now = doc.pointerLockElement === root;
    if (now && free) {
      // Taken while it was being let go: give it back.
      unlock();
      return;
    }
    locked = now;
    cursor.style.display = locked ? 'block' : 'none';
    pressedOn = null;
    mouseQuiet = false;
    if (locked) {
      const p = clampToViewport(vx, vy, win.innerWidth, win.innerHeight);
      vx = p.x;
      vy = p.y;
      mirrorHover();
      hovered = doc.elementFromPoint(vx, vy);
      chain = chainOf(hovered);
      setHoverClass([], chain);
      paintCursor();
    } else {
      clearHover();
    }
  };

  const onFullscreenChange = (): void => {
    if (doc.fullscreenElement) tryLock();
    else unlock();
  };

  // The real cursor's last place while free, so the virtual one starts
  // where the hand left it.
  const onFreeMove = (e: PointerEvent): void => {
    if (locked || e.pointerType !== 'mouse') return;
    vx = e.clientX;
    vy = e.clientY;
  };
  // A click inside while fullscreen and unlocked (after an Esc) re-locks.
  const onFreeDown = (e: PointerEvent): void => {
    if (locked || e.pointerType !== 'mouse') return;
    tryLock();
  };

  for (const type of SWALLOWED) {
    win.addEventListener(type, onNative, { capture: true, passive: false });
  }
  doc.addEventListener('pointerlockchange', onLockChange);
  doc.addEventListener('fullscreenchange', onFullscreenChange);
  win.addEventListener('pointermove', onFreeMove);
  root.addEventListener('pointerdown', onFreeDown);
  if (doc.fullscreenElement) tryLock();

  return {
    setFree: (next) => {
      if (next === free) return;
      free = next;
      if (free) unlock();
      else tryLock();
    },
    dispose: () => {
      for (const type of SWALLOWED) {
        win.removeEventListener(type, onNative, { capture: true });
      }
      doc.removeEventListener('pointerlockchange', onLockChange);
      doc.removeEventListener('fullscreenchange', onFullscreenChange);
      win.removeEventListener('pointermove', onFreeMove);
      root.removeEventListener('pointerdown', onFreeDown);
      unlock();
      locked = false;
      clearHover();
      cursor.remove();
      mirror.remove();
    },
  };
}
