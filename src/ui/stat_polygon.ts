// The Stat polygon (CONTEXT.md): stats are pulled, not typed. An
// interactive SVG radar whose vertices drag along their axes; the caller
// owns the clamp (the budget's word, via `grant`), the widget owns the
// geometry. The numbers stay visible at every axis tip, read-only,
// moving live as the shape does.

export interface PolyAxis {
  key: string;
  label: string;
  min: number;
  max: number;
  value: number;
  // How the value prints at the axis tip; default trims to 2 decimals.
  fmt?: (v: number) => string;
}

export interface StatPolygonOpts {
  // Rendered square size in px (viewBox units).
  size?: number;
  // False renders the shape without drag (a sealed champion).
  enabled: boolean;
  // The proposed value for an axis during a drag; returns what is
  // actually granted. The caller applies it to its own state.
  grant(key: string, want: number): number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function defaultFmt(v: number): string {
  if (Math.abs(v) >= 100) return String(Math.round(v));
  const two = v.toFixed(2);
  return two.replace(/\.?0+$/, '');
}

export function statPolygon(axes: PolyAxis[], opts: StatPolygonOpts): SVGSVGElement {
  const size = opts.size ?? 320;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 52;
  const n = axes.length;
  const svg = svgEl('svg', {
    viewBox: `0 0 ${size} ${size}`,
    width: String(size),
    height: String(size),
    class: `fe-poly${opts.enabled ? '' : ' off'}`,
  });

  const angleOf = (i: number): number => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const tOf = (a: PolyAxis): number =>
    a.max <= a.min ? 0 : Math.min(1, Math.max(0, (a.value - a.min) / (a.max - a.min)));
  const point = (i: number, t: number): [number, number] => [
    cx + Math.cos(angleOf(i)) * radius * t,
    cy + Math.sin(angleOf(i)) * radius * t,
  ];

  function draw(): void {
    svg.textContent = '';
    // Reference rings, quarter steps out to the field maxima.
    for (const t of [0.25, 0.5, 0.75, 1]) {
      const pts = axes.map((_, i) => point(i, t).join(',')).join(' ');
      svg.append(
        svgEl('polygon', {
          points: pts,
          fill: 'none',
          stroke: t === 1 ? '#4a3a1c' : '#33270f',
          'stroke-width': '1',
        }),
      );
    }
    for (let i = 0; i < n; i += 1) {
      const [x, y] = point(i, 1);
      svg.append(
        svgEl('line', {
          x1: String(cx),
          y1: String(cy),
          x2: String(x),
          y2: String(y),
          stroke: '#33270f',
          'stroke-width': '1',
        }),
      );
    }
    // The champion's shape.
    const shape = axes.map((a, i) => point(i, tOf(a)).join(',')).join(' ');
    svg.append(
      svgEl('polygon', {
        points: shape,
        fill: 'rgba(216, 180, 90, 0.18)',
        stroke: '#c9a84a',
        'stroke-width': '1.5',
      }),
    );
    // Labels and live values at the axis tips.
    for (let i = 0; i < n; i += 1) {
      const a = axes[i];
      if (!a) continue;
      const ang = angleOf(i);
      const lx = cx + Math.cos(ang) * (radius + 18);
      const ly = cy + Math.sin(ang) * (radius + 18);
      const anchor = Math.cos(ang) > 0.35 ? 'start' : Math.cos(ang) < -0.35 ? 'end' : 'middle';
      const label = svgEl('text', {
        x: String(lx),
        y: String(ly),
        'text-anchor': anchor,
        fill: '#97854f',
        'font-size': '10',
      });
      label.textContent = a.label;
      const value = svgEl('text', {
        x: String(lx),
        y: String(ly + 11),
        'text-anchor': anchor,
        fill: '#e0d5b8',
        'font-size': '10.5',
        'font-weight': '700',
      });
      value.textContent = (a.fmt ?? defaultFmt)(a.value);
      svg.append(label, value);
    }
    // Draggable vertices last, on top.
    for (let i = 0; i < n; i += 1) {
      const a = axes[i];
      if (!a) continue;
      const [x, y] = point(i, tOf(a));
      svg.append(
        svgEl('circle', {
          cx: String(x),
          cy: String(y),
          r: '11',
          fill: 'transparent',
          'data-axis': String(i),
        }),
      );
      svg.append(
        svgEl('circle', {
          cx: String(x),
          cy: String(y),
          r: '4.5',
          fill: '#e8cc74',
          stroke: '#241a08',
          'stroke-width': '1',
          'data-axis': String(i),
          'pointer-events': 'none',
        }),
      );
    }
  }

  // One drag at a time; the window listens so redraws mid-drag (the
  // vertex is rebuilt every frame) never drop the pointer.
  svg.addEventListener('pointerdown', (e) => {
    if (!opts.enabled) return;
    const hit = (e.target as Element).closest?.('[data-axis]');
    if (!hit) return;
    const axis = axes[Number(hit.getAttribute('data-axis'))];
    if (!axis) return;
    e.preventDefault();
    const move = (ev: PointerEvent): void => {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) * size) / rect.width;
      const py = ((ev.clientY - rect.top) * size) / rect.height;
      const i = axes.indexOf(axis);
      const ang = angleOf(i);
      const along = (px - cx) * Math.cos(ang) + (py - cy) * Math.sin(ang);
      const t = Math.min(1, Math.max(0, along / radius));
      const want = axis.min + t * (axis.max - axis.min);
      axis.value = opts.grant(axis.key, want);
      draw();
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    move(e as unknown as PointerEvent);
  });

  draw();
  return svg;
}
