// The locked cursor (src/game/cursor_lock.ts): its pure parts (the
// virtual position never leaves the window, the painted cursor is read off
// a CSS cursor value, movement turns into CSS pixels, the enter and leave
// chains, the click's target, the :hover copy, the wheel's scroll), then
// the lock itself driven over a small fake page, the way a browser sends
// a locked pointer's events: all of them to the locked element, trusted,
// with frozen coordinates and a movement.

import { describe, expect, it } from 'vitest';
import {
  clampToViewport,
  commonAncestor,
  createMovementScale,
  cursorImageOf,
  hoverChange,
  installCursorLock,
  measureMovement,
  scrollsBy,
  vhoverRules,
  vhoverSelector,
  WHEEL_LINE_PX,
  wheelPixels,
} from '../src/game/cursor_lock';

describe('the locked cursor', () => {
  it('clamps the virtual position to the window', () => {
    expect(clampToViewport(10, 20, 800, 600)).toEqual({ x: 10, y: 20 });
    expect(clampToViewport(-5, 700, 800, 600)).toEqual({ x: 0, y: 599 });
    expect(clampToViewport(900, -1, 800, 600)).toEqual({ x: 799, y: 0 });
  });

  it('reads the painted cursor and its hotspot off a CSS cursor, none off a keyword', () => {
    expect(cursorImageOf('url("data:image/png;base64,AAAA") 3 1, auto')).toEqual({
      url: 'data:image/png;base64,AAAA',
      hotX: 3,
      hotY: 1,
    });
    expect(cursorImageOf("url('x.png'), pointer")).toEqual({ url: 'x.png', hotX: 0, hotY: 0 });
    expect(cursorImageOf('pointer')).toBeNull();
    expect(cursorImageOf('')).toBeNull();
  });
});

describe("the movement's units", () => {
  it('takes the movement as it comes until there is a measure', () => {
    expect(createMovementScale().factor(2)).toBe(1);
    const scale = createMovementScale();
    for (let i = 0; i < 10; i++) scale.sample(20, 0, 10, 0);
    expect(scale.factor(2)).toBe(1);
  });

  it('measures the factor off free moves, and snaps it to the one it nears', () => {
    // Chromium at 150%: 3 physical pixels for every 2 the client point went.
    const chromium = createMovementScale();
    for (let i = 0; i < 40; i++) chromium.sample(15, 0, 10.2, 0);
    expect(chromium.factor(1.5)).toBeCloseTo(1 / 1.5);
    // Firefox: CSS pixels already.
    const firefox = createMovementScale();
    for (let i = 0; i < 40; i++) firefox.sample(0, -12, 0, -12);
    expect(firefox.factor(2)).toBe(1);
    // A page zoomed on a browser that counts neither: the measure itself.
    const odd = createMovementScale();
    for (let i = 0; i < 40; i++) odd.sample(10, 10, 16, 16);
    expect(odd.factor(1)).toBeCloseTo(1.6);
  });

  it('leaves jumps and still moves out of the measure', () => {
    const scale = createMovementScale();
    for (let i = 0; i < 40; i++) scale.sample(400, 0, 200, 0);
    for (let i = 0; i < 40; i++) scale.sample(0, 0, 0, 0);
    expect(scale.factor(2)).toBe(1);
  });
});

describe('hover, click and stylesheet rules', () => {
  it('leaves the old chain deepest first and enters the new one outermost first', () => {
    const { left, entered } = hoverChange(
      ['label', 'slot', 'bar', 'stage', 'body'],
      ['canvas', 'stage', 'body'],
    );
    expect(left).toEqual(['label', 'slot', 'bar']);
    expect(entered).toEqual(['canvas']);
    expect(
      hoverChange(['canvas', 'stage', 'body'], ['label', 'slot', 'bar', 'stage', 'body']),
    ).toEqual({ left: ['canvas'], entered: ['bar', 'slot', 'label'] });
    expect(hoverChange([], ['a', 'b'])).toEqual({ left: [], entered: ['b', 'a'] });
  });

  it("finds the press and the release's common ancestor", () => {
    interface Node {
      parentElement: Node | null;
      id: string;
    }
    const body: Node = { parentElement: null, id: 'body' };
    const stage: Node = { parentElement: body, id: 'stage' };
    const canvas: Node = { parentElement: stage, id: 'canvas' };
    const hud: Node = { parentElement: stage, id: 'hud' };
    const button: Node = { parentElement: hud, id: 'button' };
    expect(commonAncestor(canvas, button)).toBe(stage);
    expect(commonAncestor(button, button)).toBe(button);
    expect(commonAncestor(button, hud)).toBe(hud);
    expect(commonAncestor(button, { parentElement: null, id: 'apart' })).toBeNull();
  });

  it('reads :hover as the vhover class, and leaves a rule without it alone', () => {
    expect(vhoverSelector('.btn:hover')).toBe('.btn.vhover');
    expect(vhoverSelector('.a:hover .b, .c:not(:hover)')).toBe('.a.vhover .b, .c:not(.vhover)');
    expect(vhoverSelector('.btn:focus')).toBeNull();
    expect(vhoverSelector('.x:hover-ish')).toBeNull();
  });

  it("copies a sheet's :hover rules in order, an @media block around its own", () => {
    const rules = [
      { selectorText: '.a', style: { cssText: 'color: red;' } },
      { selectorText: '.a:hover', style: { cssText: 'color: blue;' } },
      {
        media: { mediaText: '(max-width: 600px)' },
        cssRules: [
          { selectorText: '.b:hover > i', style: { cssText: 'opacity: 1;' } },
          { selectorText: '.b', style: { cssText: 'opacity: 0;' } },
        ],
      },
      { media: { mediaText: 'print' }, cssRules: [{ selectorText: '.c', style: { cssText: '' } }] },
    ];
    expect(vhoverRules(rules)).toEqual([
      '.a.vhover { color: blue; }',
      '@media (max-width: 600px) { .b.vhover > i { opacity: 1; } }',
    ]);
  });

  it('counts a wheel turn in pixels, lines and pages alike', () => {
    expect(wheelPixels(100, 0, 800)).toBe(100);
    expect(wheelPixels(3, 1, 800)).toBe(3 * WHEEL_LINE_PX);
    expect(wheelPixels(-1, 2, 800)).toBe(-800);
  });

  it('scrolls a box only the way it lets its content go and has room', () => {
    const list = {
      overflowX: 'hidden',
      overflowY: 'auto',
      scrollLeft: 0,
      scrollTop: 0,
      scrollWidth: 200,
      scrollHeight: 600,
      clientWidth: 200,
      clientHeight: 200,
    };
    expect(scrollsBy(list, 0, 60)).toBe(true);
    expect(scrollsBy(list, 0, -60)).toBe(false);
    expect(scrollsBy({ ...list, scrollTop: 400 }, 0, 60)).toBe(false);
    expect(scrollsBy({ ...list, scrollTop: 400 }, 0, -60)).toBe(true);
    expect(scrollsBy({ ...list, overflowY: 'visible' }, 0, 60)).toBe(false);
    expect(scrollsBy({ ...list, scrollHeight: 200 }, 0, 60)).toBe(false);
    expect(scrollsBy(list, 60, 0)).toBe(false);
  });
});

// --- a small fake page --------------------------------------------------

type Listener = (e: FakeEvent) => void;

class FakeEvent {
  type: string;
  isTrusted: boolean;
  target: unknown = null;
  defaultPrevented = false;
  stopped = false;
  bubbles = false;
  cancelable = true;
  [key: string]: unknown;
  constructor(type: string, init: Record<string, unknown> = {}, trusted = false) {
    Object.assign(this, init);
    this.type = type;
    this.isTrusted = trusted;
  }
  preventDefault(): void {
    if (this.cancelable) this.defaultPrevented = true;
  }
  stopImmediatePropagation(): void {
    this.stopped = true;
  }
}

class FakeTarget {
  private readonly listeners = new Map<string, Listener[]>();
  parentElement: FakeElement | null = null;
  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((l) => l !== fn),
    );
  }
  dispatchEvent(e: FakeEvent): boolean {
    if (e.target === null) e.target = this;
    for (let n: FakeTarget | null = this; n && !e.stopped; n = e.bubbles ? n.parentElement : null) {
      for (const fn of [...(n.listeners.get(e.type) ?? [])]) {
        fn(e);
        if (e.stopped) break;
      }
    }
    return !e.defaultPrevented;
  }
}

class FakeElement extends FakeTarget {
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  readonly classes = new Set<string>();
  readonly classList = {
    add: (c: string) => this.classes.add(c),
    remove: (c: string) => this.classes.delete(c),
  };
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  readonly computed: Record<string, string> = {
    cursor: 'auto',
    overflowX: 'visible',
    overflowY: 'visible',
  };
  textContent = '';
  scrollTop = 0;
  scrollLeft = 0;
  scrollWidth = 100;
  scrollHeight = 100;
  clientWidth = 100;
  clientHeight = 100;
  constructor(tag: string) {
    super();
    this.tagName = tag.toUpperCase();
  }
  get isConnected(): boolean {
    return this.parentElement !== null || this.tagName === 'HTML';
  }
  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  remove(): void {
    const p = this.parentElement;
    if (p) p.children.splice(p.children.indexOf(this), 1);
    this.parentElement = null;
  }
  scrollBy(by: { left: number; top: number }): void {
    this.scrollLeft += by.left;
    this.scrollTop += by.top;
  }
  focus(): void {}
  requestPointerLock(): void {
    page.doc.pointerLockElement = this;
    page.doc.dispatchEvent(new FakeEvent('pointerlockchange'));
  }
}

class PointerEv extends FakeEvent {}
class MouseEv extends FakeEvent {}
class WheelEv extends FakeEvent {}

// Firefox's mouse events while the pointer is locked: every one, a page's
// own included, reads the point where the lock took, whatever its maker
// said (Gecko's Event::GetClientCoords and GetScreenCoords hand back the
// EventStateManager's last points while PointerLockManager::IsLocked(),
// and the page point is read off the client one).
const FROZEN = {
  clientX: 120,
  clientY: 80,
  x: 120,
  y: 80,
  screenX: 120,
  screenY: 80,
  pageX: 120,
  pageY: 80,
} as const;
class GeckoPointerEv extends PointerEv {}
class GeckoMouseEv extends MouseEv {}
class GeckoWheelEv extends WheelEv {}
for (const Ev of [GeckoPointerEv, GeckoMouseEv, GeckoWheelEv]) {
  for (const axis of Object.keys(FROZEN) as (keyof typeof FROZEN)[]) {
    const made = Symbol(axis);
    Object.defineProperty(Ev.prototype, axis, {
      configurable: true,
      get(this: Record<symbol, unknown>) {
        return page.doc.pointerLockElement ? FROZEN[axis] : this[made];
      },
      set(this: Record<symbol, unknown>, value: unknown) {
        this[made] = value;
      },
    });
  }
}

interface Page {
  win: FakeTarget;
  doc: FakeTarget & {
    fullscreenElement: FakeElement | null;
    pointerLockElement: FakeElement | null;
  };
  html: FakeElement;
  body: FakeElement;
  root: FakeElement;
  canvas: FakeElement;
  hud: FakeElement;
  slot: FakeElement;
  label: FakeElement;
  list: FakeElement;
  item: FakeElement;
  // What stands under a point: the test's own layout.
  under: (x: number, y: number) => FakeElement | null;
}

let page: Page;

// The page: a root over a canvas, and a HUD with a slot (its key label
// inside it) and a scrolling list, fullscreen; its events Firefox's when
// `gecko`.
function buildPage(opts: { dpr?: number; fullscreen?: boolean; gecko?: boolean } = {}): Page {
  const html = new FakeElement('html');
  const head = html.appendChild(new FakeElement('head'));
  const body = html.appendChild(new FakeElement('body'));
  const root = body.appendChild(new FakeElement('div'));
  const canvas = root.appendChild(new FakeElement('canvas'));
  const hud = root.appendChild(new FakeElement('div'));
  const slot = hud.appendChild(new FakeElement('div'));
  const label = slot.appendChild(new FakeElement('span'));
  const list = hud.appendChild(new FakeElement('div'));
  const item = list.appendChild(new FakeElement('button'));
  list.computed.overflowY = 'auto';
  list.scrollHeight = 600;
  list.clientHeight = 200;
  const win = Object.assign(new FakeTarget(), {
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: opts.dpr ?? 1,
    matchMedia: () => ({ matches: true }),
    getComputedStyle: (el: FakeElement) => el.computed,
    PointerEvent: opts.gecko ? GeckoPointerEv : PointerEv,
    MouseEvent: opts.gecko ? GeckoMouseEv : MouseEv,
    WheelEvent: opts.gecko ? GeckoWheelEv : WheelEv,
  });
  const doc = Object.assign(new FakeTarget(), {
    defaultView: win,
    documentElement: html,
    head,
    body,
    fullscreenElement: (opts.fullscreen === false ? null : html) as FakeElement | null,
    pointerLockElement: null as FakeElement | null,
    createElement: (tag: string) => new FakeElement(tag),
    elementFromPoint: (x: number, y: number) => page.under(x, y),
    exitPointerLock: () => {
      doc.pointerLockElement = null;
      doc.dispatchEvent(new FakeEvent('pointerlockchange'));
    },
  });
  Object.assign(win, { document: doc });
  page = {
    win,
    doc,
    html,
    body,
    root,
    canvas,
    hud,
    slot,
    label,
    list,
    item,
    // The slot at x 100..140 (its label at 100..110), the list at
    // x 300..400; the canvas everywhere else.
    under: (x) =>
      x >= 100 && x < 110
        ? label
        : x >= 100 && x < 140
          ? slot
          : x >= 300 && x < 400
            ? item
            : canvas,
  };
  return page;
}

// The hand moving the free cursor across the page, 60 moves 8 ms apart,
// each `movement` of reported movement for `client` pixels of travel.
function freeMoves(movement: number, client: number): void {
  for (let i = 1; i <= 60; i++) {
    page.win.dispatchEvent(
      new PointerEv(
        'pointermove',
        {
          pointerType: 'mouse',
          clientX: 100 + i * client,
          clientY: 300,
          movementX: movement,
          movementY: 0,
          timeStamp: 1000 + i * 8,
        },
        true,
      ),
    );
  }
}

function install() {
  return installCursorLock(page.root as unknown as HTMLElement, page.doc as unknown as Document);
}

// A locked pointer's event as the browser sends it: trusted, to the
// locked element, at the window's capture first.
function native(type: string, init: Record<string, unknown> = {}): FakeEvent {
  const e = new (type === 'wheel' ? WheelEv : type.startsWith('pointer') ? PointerEv : MouseEv)(
    type,
    {
      bubbles: true,
      button: 0,
      buttons: 0,
      movementX: 0,
      movementY: 0,
      pointerType: 'mouse',
      pointerId: 1,
      ...init,
    },
    true,
  );
  e.target = page.root;
  page.win.dispatchEvent(e);
  return e;
}

function record(el: FakeElement, types: readonly string[]): string[] {
  const seen: string[] = [];
  for (const t of types) el.addEventListener(t, (e) => seen.push(`${t}@${e.clientX}`));
  return seen;
}

describe('the lock over a page', () => {
  it('takes the lock in fullscreen and draws its cursor at the middle', () => {
    buildPage();
    const lock = install();
    expect(page.doc.pointerLockElement).toBe(page.root);
    const cursor = page.body.children.find((c) => c.style.display === 'block');
    expect(cursor?.style.transform).toBe('translate(398px, 299px)');
    lock.dispose();
    expect(page.doc.pointerLockElement).toBeNull();
  });

  it('moves by the pointer while a button is held, when a browser sends no mousemove', () => {
    buildPage();
    const lock = install();
    const moves = record(page.canvas, ['pointermove']);
    // The press: canceled at the window, so the browser sends no
    // mousemove until the release; only pointermove keeps coming.
    const down = native('pointerdown', { button: 2, buttons: 2 });
    expect(down.defaultPrevented).toBe(true);
    native('pointermove', { buttons: 2, movementX: 30, movementY: 10 });
    native('pointermove', { buttons: 2, movementX: 30, movementY: 10 });
    expect(moves).toEqual(['pointermove@430', 'pointermove@460']);
    // A mousemove beside it does not move the cursor twice.
    native('mousemove', { movementX: 30, movementY: 10 });
    native('pointermove', { movementX: 0, movementY: 0 });
    expect(moves.at(-1)).toBe('pointermove@460');
    lock.dispose();
  });

  it('moves by the mouse instead where the pointer moves carry no movement', () => {
    buildPage();
    const lock = install();
    const moves = record(page.canvas, ['pointermove']);
    native('pointermove', { movementX: 0, movementY: 0 });
    native('mousemove', { movementX: 25, movementY: 0 });
    native('pointermove', { movementX: 0, movementY: 0 });
    native('mousemove', { movementX: 25, movementY: 0 });
    expect(moves).toEqual(['pointermove@425', 'pointermove@450']);
    lock.dispose();
  });

  it('carries the virtual point on Firefox, whose locked events all read the frozen one', () => {
    // The real cursor stood at (120, 80) when the lock took. The hand
    // moves the painted one and right-clicks there: the ground's order,
    // the aim, the edge pan, the minimap and the wheel's zoom all read the
    // point off the event, which Firefox would have said was (120, 80).
    buildPage({ gecko: true });
    const lock = install();
    const seen: string[] = [];
    const types = ['pointermove', 'mousemove', 'pointerdown', 'mousedown', 'pointerup', 'mouseup'];
    for (const t of [...types, 'auxclick', 'wheel']) {
      page.canvas.addEventListener(t, (e) => {
        seen.push(`${t}@${e.clientX},${e.clientY}`);
        e.preventDefault();
      });
    }
    let press: FakeEvent | null = null;
    page.canvas.addEventListener('pointerdown', (e) => {
      press = e;
    });
    native('pointermove', { movementX: 50, movementY: -20 });
    native('pointerdown', { button: 2, buttons: 2 });
    // The point's other names say it too.
    const p = press as FakeEvent | null;
    expect([p?.x, p?.y, p?.screenX, p?.screenY, p?.pageX, p?.pageY]).toEqual([
      450, 280, 450, 280, 450, 280,
    ]);
    native('pointerup', { button: 2 });
    native('auxclick', { button: 2 });
    native('wheel', { deltaY: 120, deltaMode: 0 });
    expect(seen).toEqual([
      'pointermove@450,280',
      'mousemove@450,280',
      'pointerdown@450,280',
      'pointerup@450,280',
      'auxclick@450,280',
      'wheel@450,280',
    ]);
    lock.dispose();
  });

  it("makes the right press's contextmenu itself, Firefox sending none while locked", () => {
    // Gecko refuses a contextmenu while the pointer is locked
    // (EventStateManager::PreHandleEvent), so a right-click on an
    // inventory slot never sold its item; Chromium sends its own, after
    // the release on Windows. The lock makes one from the right press,
    // where the cursor is, and drops the browser's.
    buildPage({ gecko: true });
    const lock = install();
    const menus = record(page.slot, ['contextmenu']);
    // From the middle (400) onto the slot's face (130).
    native('pointermove', { movementX: -270 });
    native('pointerdown', { button: 2, buttons: 2 });
    native('pointerup', { button: 2 });
    expect(menus).toEqual(['contextmenu@130']);
    // A browser that sends its own: still one, and its menu held back.
    const own = native('contextmenu', { button: 2 });
    expect(own.defaultPrevented).toBe(true);
    expect(menus).toEqual(['contextmenu@130']);
    // A left press makes none.
    native('pointerdown', { buttons: 1 });
    native('pointerup');
    expect(menus).toEqual(['contextmenu@130']);
    lock.dispose();
  });

  it("turns physical pixels into the page's, measured on the page's free moves", () => {
    // A screen at 200% whose browser reports physical pixels: the menus'
    // moves, before any match, go 10 client pixels for 20 of movement.
    buildPage({ dpr: 2, fullscreen: false });
    measureMovement(page.win as unknown as Window);
    freeMoves(20, 10);
    page.doc.fullscreenElement = page.html;
    const physical = install();
    const seen = record(page.canvas, ['pointermove']);
    native('pointermove', { movementX: 40 });
    expect(seen).toEqual(['pointermove@420']);
    physical.dispose();
    // A browser that reports CSS pixels (Firefox) measures 1 and keeps it.
    buildPage({ dpr: 2, fullscreen: false });
    measureMovement(page.win as unknown as Window);
    freeMoves(10, 10);
    page.doc.fullscreenElement = page.html;
    const css = install();
    const ff = record(page.canvas, ['pointermove']);
    native('pointermove', { movementX: 40 });
    expect(ff).toEqual(['pointermove@440']);
    css.dispose();
  });

  it('enters the slot under its label and leaves both, with the vhover class along', () => {
    buildPage();
    const lock = install();
    const slotSeen = record(page.slot, ['mouseenter', 'mouseleave', 'pointerenter']);
    // From the middle (400) onto the label (105): the slot is entered too.
    native('pointermove', { movementX: -295 });
    expect(page.label.classes.has('vhover')).toBe(true);
    expect(page.slot.classes.has('vhover')).toBe(true);
    expect(page.canvas.classes.has('vhover')).toBe(false);
    // Onto the slot's own face: still in the slot, nothing new for it.
    native('pointermove', { movementX: 20 });
    expect(page.label.classes.has('vhover')).toBe(false);
    // Out to the canvas: the slot is left.
    native('pointermove', { movementX: 100 });
    expect(slotSeen).toEqual(['pointerenter@105', 'mouseenter@105', 'mouseleave@225']);
    expect(page.slot.classes.has('vhover')).toBe(false);
    lock.dispose();
  });

  it('clicks where the press and the release share an ancestor, not on what the release found', () => {
    buildPage();
    const lock = install();
    const itemClicks = record(page.item, ['click']);
    const rootClicks = record(page.root, ['click']);
    // Pressed on the canvas, released over the list's button.
    native('pointerdown', { buttons: 1 });
    native('pointermove', { buttons: 1, movementX: -50 });
    native('pointerup');
    native('click', { detail: 1 });
    expect(itemClicks).toEqual([]);
    expect(rootClicks).toEqual(['click@350']);
    // Pressed and released on it: its click.
    native('pointerdown', { buttons: 1 });
    native('pointerup');
    native('click', { detail: 1 });
    expect(itemClicks).toEqual(['click@350']);
    lock.dispose();
  });

  it('sends the mouse press after the pointer press unless a handler canceled it', () => {
    buildPage();
    const lock = install();
    const seen = record(page.canvas, ['pointerdown', 'mousedown', 'pointerup', 'mouseup']);
    native('pointerdown', { buttons: 1 });
    native('mousedown', { buttons: 1 });
    native('pointerup');
    native('mouseup');
    expect(seen).toEqual(['pointerdown@400', 'mousedown@400', 'pointerup@400', 'mouseup@400']);
    seen.length = 0;
    const cancel = (e: FakeEvent): void => e.preventDefault();
    page.canvas.addEventListener('pointerdown', cancel);
    native('pointerdown', { buttons: 1 });
    native('pointerup');
    expect(seen).toEqual(['pointerdown@400', 'pointerup@400']);
    lock.dispose();
  });

  it('scrolls the list under the cursor by hand, and leaves the canvas its zoom', () => {
    buildPage();
    const lock = install();
    native('pointermove', { movementX: -50 });
    const wheel = native('wheel', { deltaY: 120, deltaMode: 0 });
    expect(wheel.defaultPrevented).toBe(true);
    expect(page.list.scrollTop).toBe(120);
    // Lines, as Firefox counts them for a page that asks.
    native('wheel', { deltaY: 3, deltaMode: 1 });
    expect(page.list.scrollTop).toBe(120 + 3 * WHEEL_LINE_PX);
    // The canvas cancels its wheel (the zoom): no list scrolls.
    let zooms = 0;
    page.canvas.addEventListener('wheel', (e) => {
      zooms++;
      e.preventDefault();
    });
    native('pointermove', { movementX: 200 });
    native('wheel', { deltaY: 120, deltaMode: 0 });
    expect(zooms).toBe(1);
    expect(page.list.scrollTop).toBe(120 + 3 * WHEEL_LINE_PX);
    lock.dispose();
  });

  it("keeps a Firefox notch in lines: the wheel's copy reads the mode before the deltas", () => {
    // Firefox turns a wheel's lines into pixels of its own line height for
    // a page that reads the deltas first. The zoom (game/wheel_step.ts)
    // reads the mode first and counts three lines as a pixel wheel's notch,
    // so the copy under the lock carries the lines as they came, and a
    // notch zooms as far locked as free.
    buildPage();
    const lock = install();
    const seen: [unknown, unknown][] = [];
    page.canvas.addEventListener('wheel', (e) => {
      seen.push([e.deltaMode, e.deltaY]);
      e.preventDefault();
    });
    const reads: string[] = [];
    const wheel = new WheelEv('wheel', { bubbles: true, button: 0, buttons: 0 }, true);
    const fields: Record<string, number> = { deltaMode: 1, deltaX: 0, deltaY: 3, deltaZ: 0 };
    for (const [key, value] of Object.entries(fields)) {
      Object.defineProperty(wheel, key, {
        get: () => {
          reads.push(key);
          return value;
        },
      });
    }
    wheel.target = page.root;
    page.win.dispatchEvent(wheel);
    expect(reads[0]).toBe('deltaMode');
    expect(seen).toEqual([[1, 3]]);
    expect(wheel.defaultPrevented).toBe(true);
    lock.dispose();
  });

  it('lets events not sent to the locked element through: a key on a button, a click() call', () => {
    buildPage();
    const lock = install();
    // Under the virtual cursor, where a click taken for the lock's would go.
    const clicks = record(page.canvas, ['click']);
    const byKey = new MouseEv('click', { bubbles: true, detail: 0 });
    Object.assign(byKey, { isTrusted: true });
    page.win.dispatchEvent(Object.assign(byKey, { target: page.slot }));
    expect(byKey.stopped).toBe(false);
    const byCode = new MouseEv('click', { bubbles: true });
    page.win.dispatchEvent(Object.assign(byCode, { target: page.root }));
    expect(byCode.stopped).toBe(false);
    expect(clicks).toEqual([]);
    lock.dispose();
  });

  it('lets the cursor go while asked, and takes it back in fullscreen only', () => {
    buildPage();
    const lock = install();
    lock.setFree(true);
    expect(page.doc.pointerLockElement).toBeNull();
    // A click while free (the pause menu's) does not take it back.
    page.root.dispatchEvent(new PointerEv('pointerdown', { pointerType: 'mouse' }, true));
    expect(page.doc.pointerLockElement).toBeNull();
    // Where the hand left it is where the virtual cursor starts.
    page.win.dispatchEvent(
      new PointerEv('pointermove', { pointerType: 'mouse', clientX: 120, clientY: 50 }, true),
    );
    lock.setFree(false);
    expect(page.doc.pointerLockElement).toBe(page.root);
    expect(page.slot.classes.has('vhover')).toBe(true);
    // Out of fullscreen (the browser's Esc): the lock goes, and a click
    // does not trap the cursor again.
    page.doc.fullscreenElement = null;
    page.doc.dispatchEvent(new FakeEvent('fullscreenchange'));
    expect(page.doc.pointerLockElement).toBeNull();
    page.root.dispatchEvent(new PointerEv('pointerdown', { pointerType: 'mouse' }, true));
    expect(page.doc.pointerLockElement).toBeNull();
    // Back in fullscreen: taken again.
    page.doc.fullscreenElement = page.html;
    page.doc.dispatchEvent(new FakeEvent('fullscreenchange'));
    expect(page.doc.pointerLockElement).toBe(page.root);
    lock.dispose();
  });

  it('measures under the pause menu too, and never off the frozen moves of a lock', () => {
    buildPage({ dpr: 2 });
    const first = install();
    // Locked: the browser's moves carry a frozen client point, no measure.
    for (let i = 0; i < 60; i++) native('pointermove', { movementX: 20, clientX: 5, timeStamp: i });
    first.setFree(true);
    freeMoves(20, 10);
    first.dispose();
    const second = install();
    const seen = record(page.canvas, ['pointermove']);
    native('pointermove', { movementX: 40 });
    expect(seen).toEqual(['pointermove@420']);
    second.dispose();
  });
});
