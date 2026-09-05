// Who the night coach is for. The night has two halves and only one of
// them has a bill on it: the Arena and the sparring are CPU, the model
// call is money. A deposited bot keeps playing its rounds forever, so
// before this gate every bot ever deposited earned a coach call every
// night for good, whether or not its owner ever came back to read the
// Briefing: the cost followed registrations instead of players.
//
// So the call waits for an owner who is still around. The Arena still
// plays, the report is still written, and the briefing window still
// advances every night, so a returning owner finds a ladder that moved
// and a coach that resumes the same night on last night's matches, not
// on a month of backlog.

const DAY_MS = 24 * 60 * 60 * 1000;

// How long an owner may be away before their bot's night stops calling
// the model. A week: someone who looks in once a week keeps their coach.
export const COACH_IDLE_DAYS = 7;

export function coachEligible(
  seenAt: number | null,
  now: number,
  idleDays: number = COACH_IDLE_DAYS,
): boolean {
  // Zero or less switches the gate off: every deposited bot is coached,
  // which is what a private server with a known handful of players wants.
  if (idleDays <= 0) return true;
  // An owner the host cannot date is not one to spend a model call on.
  if (seenAt === null) return false;
  return now - seenAt <= idleDays * DAY_MS;
}
