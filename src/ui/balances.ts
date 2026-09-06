// The two things an account holds, drawn rather than spelled.
//
// Both were printed as words wherever they appeared: "1250 laurels", "40
// embers", "Recruit for 500 laurels". That reads as prose in a place that
// wants a number, it says the noun three times on one screen, and it puts
// the unit in English in a bar that is otherwise wordless. A mark carries
// a unit in one glyph, which is what every game with two currencies works
// out eventually.
//
// They must never be confusable, because nothing converts one into the
// other (ADR 0017, ADR 0018): a laurel is earned by playing and buys what
// costs nothing to hand out, an ember is granted and is a cent the server
// spends at a provider. So they share no shape and no colour. The laurel
// is a wreath, cool gold, closed and still, and it is what a match pays.
// The ember is a flame, warm orange, and it burns down.
//
// SVG rather than the canvas the item icons use (ui/icons.ts): these are
// 14px beside text, on every screen, and a canvas tile at that size is
// mush. The wreath's leaves are computed along its arc rather than hand
// authored, so the shape is described by the numbers that make it and a
// test can read them.

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

// Which of the two. Not a name for the pair: the glossary is deliberate
// that they are not one kind of thing (CONTEXT.md: Laurel), so this is
// only the two balances an account sheet carries.
export type BalanceKind = 'laurels' | 'embers';

// The word, for the tooltip and for a screen reader. The point of the
// mark is that the word stops being printed, not that it stops existing:
// an icon nobody can name is a worse label than the word it replaced.
export const BALANCE_WORD: Readonly<Record<BalanceKind, string>> = {
  laurels: 'Laurels, earned by playing',
  embers: 'Embers, the weekly grant the Forge and the Academy spend',
};

export const BALANCE_COLOR: Readonly<Record<BalanceKind, string>> = {
  laurels: '#e6d7a8',
  embers: '#ff9d4a',
};

// One leaf of the wreath, as an ellipse laid on the arc and turned to sit
// along it. Kept exported so a test can check the shape without a DOM.
export interface WreathLeaf {
  x: number;
  y: number;
  angleDeg: number;
  side: -1 | 1;
}

// Leaves per side. Five reads as a wreath at 14px; more turns to a blur
// and fewer reads as a bracket.
export const LEAVES_PER_SIDE = 5;
// Half the length and half the width of one leaf.
export const LEAF_RX = 3.05;
export const LEAF_RY = 1.2;

// The wreath's arc, on a 24 box. Degrees are measured from the foot, so 0
// is the bottom of the circle and 180 the crown; each side sweeps its own
// way out from the foot.
//
// The span is what makes it a wreath rather than a ring. Ending at 156
// and not at 180 leaves the crown open by more than a leaf is long, which
// is the whole silhouette: a ring closed at the top is a coin, and a coin
// is what the other mark must never look like either.
const WREATH_CX = 12;
const WREATH_CY = 12;
const WREATH_R = 7.6;
export const WREATH_START_DEG = 15;
export const WREATH_END_DEG = 156;

export function wreathPoint(
  deg: number,
  side: -1 | 1,
  radius = WREATH_R,
): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return {
    x: WREATH_CX + side * radius * Math.sin(rad),
    y: WREATH_CY + radius * Math.cos(rad),
  };
}

// The leaves sit a little outside the stem, so the branch shows on the
// inside of the curve the way it does on a real wreath.
const LEAF_R = WREATH_R + 1.1;
// How far a leaf leans off the tangent, towards the crown. A leaf laid
// flat along the arc reads as a link in a chain; leaning them all the
// same way is what makes the shape grow rather than repeat.
export const LEAF_LEAN_DEG = 34;

// The angle of the leaf at `deg` on the right-hand branch. The first cut
// of this used (90 - deg), which is the normal and not the tangent, so
// every leaf pointed at the centre and the mark came out a cog.
export function leafAngle(deg: number): number {
  const rad = (deg * Math.PI) / 180;
  // Walking the arc, x moves with cos and y against sin (SVG y grows
  // downwards), which is the direction the leaf lies in.
  const tangent = (Math.atan2(-Math.sin(rad), Math.cos(rad)) * 180) / Math.PI;
  return tangent + LEAF_LEAN_DEG;
}

export function wreathLeaves(): WreathLeaf[] {
  const out: WreathLeaf[] = [];
  const span = WREATH_END_DEG - WREATH_START_DEG;
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < LEAVES_PER_SIDE; i++) {
      const deg = WREATH_START_DEG + (i / (LEAVES_PER_SIDE - 1)) * span;
      const { x, y } = wreathPoint(deg, side, LEAF_R);
      const right = leafAngle(deg);
      // The left branch is the right one reflected, and reflecting an
      // angle about the vertical is 180 minus it. Doing it this way
      // rather than by negating keeps the two sides exactly mirrored,
      // which is the one thing the eye catches at 14px.
      out.push({ x, y, angleDeg: side === 1 ? right : 180 - right, side });
    }
  }
  return out;
}

function laurelSvg(size: number): SVGSVGElement {
  const svg = svgEl('svg', {
    viewBox: '0 0 24 24',
    width: String(size),
    height: String(size),
    fill: 'none',
    'aria-hidden': 'true',
  });
  const color = 'currentColor';
  for (const side of [-1, 1] as const) {
    // The stem, from the same arc the leaves sit on and drawn first so
    // they sit on it. It runs a little past the leaves at both ends, the
    // way a branch does.
    const a = wreathPoint(WREATH_START_DEG - 7, side);
    const b = wreathPoint(WREATH_END_DEG + 6, side);
    const sweep = side === -1 ? 1 : 0;
    svg.appendChild(
      svgEl('path', {
        d: `M${a.x.toFixed(2)} ${a.y.toFixed(2)}A${WREATH_R} ${WREATH_R} 0 0 ${sweep} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`,
        stroke: color,
        'stroke-width': '1.4',
        'stroke-linecap': 'round',
        opacity: '0.8',
      }),
    );
  }
  for (const leaf of wreathLeaves()) {
    svg.appendChild(
      svgEl('ellipse', {
        cx: '0',
        cy: '0',
        rx: String(LEAF_RX),
        ry: String(LEAF_RY),
        fill: color,
        transform: `translate(${leaf.x.toFixed(2)} ${leaf.y.toFixed(2)}) rotate(${leaf.angleDeg.toFixed(1)})`,
      }),
    );
  }
  return svg;
}

function emberSvg(size: number): SVGSVGElement {
  const svg = svgEl('svg', {
    viewBox: '0 0 24 24',
    width: String(size),
    height: String(size),
    fill: 'none',
    'aria-hidden': 'true',
  });
  // The flame, and the hotter core inside it. Two tones and no gradient:
  // a gradient needs an id, and an id in a page that mounts this mark a
  // dozen times is a dozen collisions.
  svg.appendChild(
    svgEl('path', {
      d: 'M12 2.4c3.4 3.6 5.9 6.6 5.9 10.2a5.9 5.9 0 0 1-11.8 0c0-1.9.8-3.6 2-5 .3 1.4 1 2.3 2 2.7C9.6 8.5 10.3 5.4 12 2.4Z',
      fill: 'currentColor',
    }),
  );
  svg.appendChild(
    svgEl('path', {
      // The hotter centre, as white laid over whatever the flame is: a
      // fixed pale tone reads as a hole once the mark sits on a gold
      // button rather than on the dark page.
      d: 'M12 12.1c1.6 1.7 2.5 3 2.5 4.4a2.5 2.5 0 0 1-5 0c0-1.4.9-2.7 2.5-4.4Z',
      fill: '#ffffff',
      opacity: '0.62',
    }),
  );
  return svg;
}

export function balanceIcon(kind: BalanceKind, size = 14): SVGSVGElement {
  return kind === 'laurels' ? laurelSvg(size) : emberSvg(size);
}

// A number wearing its mark. The mark leads on the left the way a
// currency symbol does, so a column of these lines up on the digits.
export function balanceTag(kind: BalanceKind, n: number, size = 14): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = `bal bal-${kind}`;
  span.title = BALANCE_WORD[kind];
  span.setAttribute('aria-label', `${n} ${kind}`);
  span.appendChild(balanceIcon(kind, size));
  const value = document.createElement('b');
  value.textContent = format(n);
  span.appendChild(value);
  return span;
}

// Updates a tag built above, so a balance that changes does not rebuild
// its own icon.
export function setBalanceTag(span: HTMLElement, kind: BalanceKind, n: number): void {
  span.setAttribute('aria-label', `${n} ${kind}`);
  const value = span.querySelector('b');
  if (value) value.textContent = format(n);
}

// The separator between thousands: U+202F, narrow and no-break. Narrow
// because a bar has room for the mark and the number and not for a wide
// one, no-break because "1 250" wrapping after the 1 turns a balance into
// two numbers. Written as an escape and not as the character: it is
// invisible in the source, and an ordinary space typed over it by
// accident would look identical and behave differently.
export const THOUSANDS = '\u202f';

export function format(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS);
}

export const BALANCE_CSS = `
/* Both marks draw in currentColor, so the class sets the hue once and
   the mark and its number can never drift apart. */
.bal { display: inline-flex; align-items: center; gap: 5px; line-height: 1; }
.bal svg { display: block; flex: none; }
.bal b { font-variant-numeric: tabular-nums; font-weight: 700; color: inherit; }
.bal-laurels { color: ${BALANCE_COLOR.laurels}; }
.bal-embers { color: ${BALANCE_COLOR.embers}; }
/* On a button the mark takes the button's own text colour, because the
   Forge's calls to action are filled gold and an orange flame on gold is
   a smudge. Inside a button the shape carries which unit it is, and the
   sentence around it says so too. */
button .bal { color: inherit; }
`;
