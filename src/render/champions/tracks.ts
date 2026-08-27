// Keyframe track surgery for champion clips. Pure array math, no three.js
// imports, so the contract test exercises it from plain node; assets.ts
// applies it to live AnimationClip tracks at load.

// Pins every later key of a vec3 track to its first key, in place. Motion
// libraries often bake root travel into the hip bone's position track; a
// clip listed in a def's inPlaceClips gets its hip track pinned so the clip
// plays on the spot and the sim stays the only source of movement.
export function pinTrackToFirstKey(values: { length: number; [i: number]: number }): void {
  const x = values[0] ?? 0;
  const y = values[1] ?? 0;
  const z = values[2] ?? 0;
  for (let i = 3; i + 2 < values.length; i += 3) {
    values[i] = x;
    values[i + 1] = y;
    values[i + 2] = z;
  }
}
