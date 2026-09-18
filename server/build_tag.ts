// The build the page was served under, written into the page itself: a
// meta element the client reads as its own build id (src/net/build_watch.ts)
// and stamps every address it loads with (src/game/asset_version.ts).
// The id is the bundle's name plus the deployment's stamp
// (server/build_info.ts), so it moves on every deployment and the client
// compares it with what /api/public/build says; under the dev server no
// tag is written and nothing reloads.

export const BUILD_META = 'build';

export function isBuildId(value: string): boolean {
  return /^[A-Za-z0-9_.-]{1,80}$/.test(value);
}

export function buildTag(build: string): string {
  return `<meta name="${BUILD_META}" content="${build}">`;
}

export function withBuildTag(html: string, build: string | null): string {
  if (build === null || !isBuildId(build)) return html;
  const at = html.search(/<\/head>/i);
  if (at < 0) return html;
  return `${html.slice(0, at)}    ${buildTag(build)}\n  ${html.slice(at)}`;
}
