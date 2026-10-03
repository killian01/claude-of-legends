// The drop's view of the globe (ADR 0031: ten seconds over the planet to
// pick where to land): the orbit the camera holds around the planet's
// center, and the ease of the dive down to the champion once the drop
// ends. Pure, so the camera's path is testable.

export interface DropOrbit {
  // Radians around the vertical, and above the planet's equator plane.
  azimuth: number;
  elevation: number;
  // Meters from the planet's center.
  distance: number;
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

// Where the orbiting camera stands around the center.
export function orbitPosition(center: Point3, o: DropOrbit): Point3 {
  const c = Math.cos(o.elevation);
  return {
    x: center.x + o.distance * c * Math.sin(o.azimuth),
    y: center.y + o.distance * Math.sin(o.elevation),
    z: center.z + o.distance * c * Math.cos(o.azimuth),
  };
}

// The dive's progress for its elapsed fraction: eased in and out, a
// slow start off the globe, a fast fall, a soft landing; 1 once done.
export function diveProgress(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}
