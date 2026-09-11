// What the viewer says when it refuses a replay (src/main.ts, runReplay),
// pure so the wording is tested. Three cases: the record is gone (the
// server keeps only the most recent matches); the record is older than
// the game (a re-simulation would play a different match); or the page is
// older than the server, which wrote the record under the build it runs
// (server/build_info.ts): then the record is fine and the page must be
// reloaded, and saying "older version" about the record would be wrong.

import { REPLAY_VERSION } from '../net/replay';

export interface ReplayRefusal {
  title: string;
  text: string;
}

export function replayRefusal(
  record: { version?: unknown; content?: unknown } | null,
  server: { version: number; content: string } | null,
  clientContent: string,
): ReplayRefusal {
  if (!record || typeof record.version !== 'number') {
    return {
      title: 'Replay unavailable',
      text: 'This replay is gone: the server keeps only the most recent matches.',
    };
  }
  const serverHasIt =
    server !== null && server.version === record.version && server.content === record.content;
  const pageBehind =
    server !== null && (server.version !== REPLAY_VERSION || server.content !== clientContent);
  if (serverHasIt || pageBehind) {
    return {
      title: 'This page is out of date',
      text:
        'The game was updated since this page was opened, and this replay was recorded on ' +
        'the new version. Reload the page and open it again.',
    };
  }
  return {
    title: 'Replay unavailable',
    text:
      'This replay was recorded on an older version of the game (a champion, an item or ' +
      'the map has changed since), so replaying it would show a different match from the ' +
      'one that was played. The result on the Record stands: it is what happened.',
  };
}
