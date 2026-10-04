// Source seconds shared by the authored quadruped Spawn and its rupture.
export const VOIDMAUL_SPAWN_TIMING = {
  rupture: 0.45,
  foreGrabR: 0.6,
  foreGrabL: 0.72,
  rearArrivalR: 1.82,
  fullEmergence: 2.02,
  stomp: 2.3,
  bellowEnd: 3.2,
  end: 4,
} as const;

export const VOIDMAUL_SPAWN_BEATS = [
  { kind: 'rupture', at: VOIDMAUL_SPAWN_TIMING.rupture },
  { kind: 'landing', at: VOIDMAUL_SPAWN_TIMING.fullEmergence },
  { kind: 'stomp', at: VOIDMAUL_SPAWN_TIMING.stomp },
] as const;

export type VoidmaulSpawnBeat = (typeof VOIDMAUL_SPAWN_BEATS)[number]['kind'];
