// One account in one mode at a time, the 5v5's side of it: whether an
// account plays a seat in a 5v5 still running from any of its tabs (the
// battle royale and Thornfray ask this before seating it), and which of the
// socket's messages open a way into a 5v5, refused while the account plays
// a royale or a Thornfray from another tab.

export interface ClassicSocket {
  id: number;
  accountId: number;
  matchId: number | null;
}

// A seat left to its bot (a dropped connection, a walk-out) does not count:
// its owner may play elsewhere and come back to it later. A spectator holds
// no seat, and an ended match none either; `seated` says both.
export function classicPlaying(
  owner: number,
  sockets: Iterable<ClassicSocket>,
  seated: (matchId: number, clientId: number) => boolean,
): boolean {
  for (const s of sockets) {
    if (s.accountId === owner && s.matchId !== null && seated(s.matchId, s.id)) return true;
  }
  return false;
}

// The queue, a lobby and the start of a party: every door into a 5v5.
const CLASSIC_DOORS: ReadonlySet<string> = new Set([
  'queue',
  'start_now',
  'create_lobby',
  'join_lobby',
  'queue_party',
]);

export function classicDoorRefused(msgType: string, elsewhere: () => boolean): boolean {
  return CLASSIC_DOORS.has(msgType) && elsewhere();
}
