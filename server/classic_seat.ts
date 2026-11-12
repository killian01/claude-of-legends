// One account in one mode at a time, the 5v5's side of it: whether an
// account plays a seat in a 5v5 still running from any of its tabs (the
// battle royale and Thornfray ask this before seating it), and which of the
// socket's messages open a way into a 5v5, refused while the account plays
// a royale or a Thornfray from another tab, and the way out of every door
// for all the account's tabs when one of them enters either.

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

// Entering a royale or a Thornfray takes every tab of the account out of
// the 5v5's queue, lobbies and champion select, not only the tab that
// entered: a tab left waiting would be seated in a 5v5 while the account
// plays elsewhere (a seat left in a select goes to its bot). A tab other
// than the entering one that was waiting is told why it left.
export function leaveClassicDoors(
  entering: Pick<ClassicSocket, 'id' | 'accountId'>,
  sockets: Iterable<ClassicSocket>,
  remove: (clientId: number) => boolean,
  tell: (clientId: number) => void,
): void {
  for (const s of [...sockets]) {
    if (s.accountId !== entering.accountId) continue;
    if (remove(s.id) && s.id !== entering.id) tell(s.id);
  }
}
