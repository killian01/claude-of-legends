// The Star Orchard's records as the browser reads them (ADR 0021): the
// manifest, the gameplay layout and the walkability grid, fetched once per
// page and assembled into the StarOrchard every match is built on. Half a
// megabyte, and wanted by the workers too (a replay's second pass, a
// sparring match), which is why the model lives in its own module
// (star_orchard.ts): a worker wants the grid and never Three.js.

import {
  assembleStarOrchard,
  type StarOrchard,
  type StarOrchardLayout,
  type StarOrchardManifest,
} from '../sim/content/star_orchard';

export const STAR_ORCHARD_ROOT = '/map/star-orchard/';

export async function fetchOrchardFile(path: string): Promise<Response> {
  const res = await fetch(`${STAR_ORCHARD_ROOT}${path}`);
  if (!res.ok) throw new Error(`could not load ${path} (${res.status})`);
  return res;
}

let cached: Promise<StarOrchard> | null = null;

export function loadStarOrchard(): Promise<StarOrchard> {
  if (cached) return cached;
  const load = async (): Promise<StarOrchard> => {
    const [manifest, layout, navigation] = await Promise.all([
      fetchOrchardFile('manifest.json').then((r) => r.json() as Promise<StarOrchardManifest>),
      fetchOrchardFile('gameplay.json').then((r) => r.json() as Promise<StarOrchardLayout>),
      fetchOrchardFile('navigation.bin').then((r) => r.arrayBuffer()),
    ]);
    return assembleStarOrchard(layout, manifest, navigation);
  };
  cached = load().catch((err) => {
    cached = null;
    throw err;
  });
  return cached;
}
