// Paw contact measured in the shipped Attack at 1.75 s: glTF source
// (x,z)=(.26546222,.23808068), at model scale 12.9 and holder scale 1.1.
// Match data lives here so damage geometry and the content fingerprint
// never depend on a renderer or a loaded asset.
export type VoidmaulAttackKind = 'slam' | 'crush';

export const VOIDMAUL_SLAM = {
  pawSide: 3.7669089018,
  pawForward: 3.3783648492,
  // Equal-weight midpoint of both AttackCrush soles at the same contact.
  // The half-difference places R and L marks about that midpoint.
  crushPawSide: 0.404608011246,
  crushPawForward: 3.624890565872,
  crushPawSpread: 3.362299442291,
  crushPawSpreadForward: -0.246526822448,
  radius: 5.5,
  ascendantScale: 1.35,
  ascendantRadius: 7.25,
  splashRatio: 0.65,
  // A stone of the rain landing on a unit: this share of a slam's hit.
  stoneRatio: 0.4,
} as const;

export const VOIDMAUL_SLAM_PAW_SIDE = VOIDMAUL_SLAM.pawSide;
export const VOIDMAUL_SLAM_PAW_FORWARD = VOIDMAUL_SLAM.pawForward;
