// Which of the two team looks a unit wears for a viewer (ADR 0030): the
// colors are a pair, blue then red. The 5v5 paints each side its own, team 0
// blue and team 1 red for everyone, so the two sides read the same on every
// screen. A match of any other team count paints the viewer's own team as
// the ally (blue) and every other team as an enemy (red): in a free-for-all
// everyone else is an enemy.

import { TWO_TEAMS } from '../sim/teams';
import type { TeamId } from '../sim/types';

export function teamLook(team: TeamId, viewerTeam: TeamId, teamCount = TWO_TEAMS): TeamId {
  if (teamCount === TWO_TEAMS) return team;
  return team === viewerTeam ? 0 : 1;
}
