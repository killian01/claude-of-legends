// The warning a silent 5v5 seat gets before the AFK sweep hands its
// champion to a bot (server/afk.ts): a toast held until the sweep would
// come, and a tab title that says it to a page in the background.

export const AFK_TITLE_MARK = 'Still there? ';

export function afkWarnLine(seconds: number): string {
  return `Still there? Give any order within ${seconds} s or a bot takes your champion over.`;
}

// Said by the first order after the warning.
export const AFK_KEPT_LINE = 'You keep your champion.';

// The tab's title while the warning stands, and back once it is over;
// never marked twice.
export function afkTitle(title: string, on: boolean): string {
  const bare = title.startsWith(AFK_TITLE_MARK) ? title.slice(AFK_TITLE_MARK.length) : title;
  return on ? AFK_TITLE_MARK + bare : bare;
}
