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

// The Respawn wait's globe (ui/royale_return.ts): the orbit that looks
// down on a world direction from the planet's center (the light a return
// comes back to), its elevation kept off the vertical where the orbit's
// up turns over, as a drag keeps it.
export const ORBIT_ELEVATION_MAX = 1.35;

export function facingOrbit(dir: Point3, distance: number): DropOrbit {
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const y = Math.max(-1, Math.min(1, dir.y / len));
  const elevation = Math.max(-ORBIT_ELEVATION_MAX, Math.min(ORBIT_ELEVATION_MAX, Math.asin(y)));
  return { azimuth: Math.atan2(dir.x, dir.z), elevation, distance };
}

// How far the wait's camera stands from the planet's center: the whole
// globe, a little smaller than the drop's, while the light is wide, nearer
// as it narrows so a small light is big enough to tap, never into the
// atmosphere's shell.
export const RETURN_ORBIT_MAX = 330;
export const RETURN_ORBIT_MIN = 160;

export function returnOrbitDistance(lightRadius: number): number {
  return Math.max(RETURN_ORBIT_MIN, Math.min(RETURN_ORBIT_MAX, 130 + 2.5 * lightRadius));
}

// Where the wait's globe sits on the screen, as shares of its width right
// of the middle and of its height below it: in the middle, where the eye
// already is when the play rig rises to it, a little low so it stays under
// the Graft cards over the top. The death wash's lines stand in the column
// left of it (ui/royale_return.ts).
export const RETURN_GLOBE_RIGHT = 0;
export const RETURN_GLOBE_DOWN = 0.07;
