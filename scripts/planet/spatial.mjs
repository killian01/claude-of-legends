// A hash of items placed at directions on the planet, for "what is near
// here" questions during the layout. Keys are 3D buckets of the point on
// the sphere of radius 80; queries take a radius in meters (chord).

import { RADIUS } from './sphere.mjs';

export class PointHash {
  constructor(bucket = 6) {
    this.bucket = bucket;
    this.map = new Map();
  }

  key(x, y, z) {
    return ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
  }

  insert(d, item) {
    const b = this.bucket;
    const k = this.key(
      Math.floor((d[0] * RADIUS) / b),
      Math.floor((d[1] * RADIUS) / b),
      Math.floor((d[2] * RADIUS) / b),
    );
    let list = this.map.get(k);
    if (!list) {
      list = [];
      this.map.set(k, list);
    }
    list.push({ d, item });
  }

  // Calls fn(item, meters) for every item whose point lies within `meters`.
  query(d, meters, fn) {
    const b = this.bucket;
    const x = d[0] * RADIUS;
    const y = d[1] * RADIUS;
    const z = d[2] * RADIUS;
    const x0 = Math.floor((x - meters) / b);
    const x1 = Math.floor((x + meters) / b);
    const y0 = Math.floor((y - meters) / b);
    const y1 = Math.floor((y + meters) / b);
    const z0 = Math.floor((z - meters) / b);
    const z1 = Math.floor((z + meters) / b);
    const m2 = meters * meters;
    for (let bx = x0; bx <= x1; bx++) {
      for (let by = y0; by <= y1; by++) {
        for (let bz = z0; bz <= z1; bz++) {
          const list = this.map.get(this.key(bx, by, bz));
          if (!list) continue;
          for (const e of list) {
            const dx = e.d[0] * RADIUS - x;
            const dy = e.d[1] * RADIUS - y;
            const dz = e.d[2] * RADIUS - z;
            const q = dx * dx + dy * dy + dz * dz;
            if (q <= m2) fn(e.item, Math.sqrt(q));
          }
        }
      }
    }
  }

  any(d, meters, pred) {
    let hit = false;
    this.query(d, meters, (item, m) => {
      if (!hit && pred(item, m)) hit = true;
    });
    return hit;
  }
}
