// The AFK sweep's clock for a 5v5 seat (server/main.ts): a connected
// player silent for AFK_IDLE_TICKS walks out and a bot takes the champion
// over. AFK_WARN_TICKS of silence first earns one warning, so a person who
// looked away has the rest of the time to give any order and keep the seat.
// The sweep runs every AFK_SWEEP_TICKS, so the warning always lands
// AFK_IDLE_TICKS - AFK_WARN_TICKS before the removal.

export const AFK_IDLE_TICKS = 20 * 120;
export const AFK_WARN_TICKS = 20 * 90;
export const AFK_SWEEP_TICKS = 200;

// Seconds a warned seat has left to act, as the warning tells it.
export const AFK_WARN_SECONDS = (AFK_IDLE_TICKS - AFK_WARN_TICKS) / 20;

export type AfkCall = 'remove' | 'warn' | null;

// What the sweep does to a seat silent for silentTicks; warned says the
// warning already went out for this silence (it is sent once).
export function afkCall(
  silentTicks: number,
  warned: boolean,
  idleTicks: number = AFK_IDLE_TICKS,
  warnTicks: number = AFK_WARN_TICKS,
): AfkCall {
  if (silentTicks > idleTicks) return 'remove';
  if (silentTicks > warnTicks && !warned) return 'warn';
  return null;
}
