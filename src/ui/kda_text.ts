// A K/D/A read over several matches: per match, one decimal, never the
// totals (a total reads as one impossible game). Pure, for the profile
// and the ladder alike.

export function perMatch(total: number, games: number): string {
  if (games <= 0) return '0';
  const v = total / games;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function kdaPerMatch(kills: number, deaths: number, assists: number, games: number): string {
  return `${perMatch(kills, games)} / ${perMatch(deaths, games)} / ${perMatch(assists, games)}`;
}
