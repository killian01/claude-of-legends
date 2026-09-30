import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { offlineApiNotice, offlineApiReply } from './scripts/dev_api_fallback.ts';
import { precompressDir } from './scripts/precompress.ts';
import { STAMPS_FILE, stampTable } from './scripts/public_stamps.ts';

// The raw Blender exports of the Star Orchard (docs/star-orchard.md) live
// in art_src/map_exports/, gitignored and outside public/ so a build never
// copies a gigabyte of revisions; the dev pages that compare revisions
// read them under /map-exports/ on the dev server only.
const MAP_EXPORTS = path.resolve('art_src/map_exports');
const MAP_EXPORT_TYPES: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.json': 'application/json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};
function serveMapExports(): Plugin {
  return {
    name: 'loc-map-exports',
    configureServer(server) {
      server.middlewares.use('/map-exports', (req, res, next) => {
        const file = path.join(MAP_EXPORTS, decodeURIComponent((req.url ?? '/').split('?')[0]!));
        if (!file.startsWith(MAP_EXPORTS) || !existsSync(file) || !statSync(file).isFile()) {
          next();
          return;
        }
        res.setHeader(
          'content-type',
          MAP_EXPORT_TYPES[path.extname(file)] ?? 'application/octet-stream',
        );
        res.setHeader('content-length', String(statSync(file).size));
        createReadStream(file).pipe(res);
      });
    },
  };
}

// The content stamps of public/ (scripts/public_stamps.ts), hashed once
// per build: the client's code gets the table as a constant, which the
// workers' bundles inherit, so every address it stamps names its file's
// bytes (src/game/asset_version.ts); the copy written beside the built
// client is what the server keeps stamped addresses for good by
// (server/static_files.ts). Nothing under the dev server, which serves
// public/ as it stands.
function publicStamps(): Plugin {
  let table: Record<string, string> = {};
  return {
    name: 'loc-public-stamps',
    apply: 'build',
    async config(config) {
      const dir =
        config.publicDir === false
          ? null
          : path.resolve(config.root ?? process.cwd(), config.publicDir ?? 'public');
      table = dir !== null && existsSync(dir) ? await stampTable(dir) : {};
      return { define: { 'globalThis.__LOC_FILE_STAMPS__': JSON.stringify(table) } };
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: STAMPS_FILE, source: JSON.stringify(table) });
    },
  };
}

// The gzip twins beside the built client's big compressible files
// (scripts/precompress.ts), written once the whole build, public/ copied
// in, is on disk; the server sends them (server/static_files.ts).
function precompressBuild(): Plugin {
  let outDir = 'dist';
  return {
    name: 'loc-precompress',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const r = await precompressDir(outDir);
      const mb = (n: number): string => (n / 1e6).toFixed(1);
      console.log(`gzip twins: ${r.files} files, ${mb(r.before)} MB to ${mb(r.after)} MB`);
    },
  };
}

// Dev: the Vite client talks to the game server on PORT, the variable the
// server itself listens on, read from the shell or from .env (default
// 8787). A second checkout, a worktree beside the first, then runs its own
// pair with one line in its .env; Vite picks the next free port for the
// client on its own and prints it.
export default defineConfig(({ mode }) => {
  const port = Number(loadEnv(mode, process.cwd(), '').PORT || 8787);
  return {
    plugins: [serveMapExports(), publicStamps(), precompressBuild()],
    server: {
      watch: {
        // art_src/ holds the raw 2048px icon sources: nothing imports them, and
        // watching files that are still being copied in crashes the dev server
        // with EBUSY on Windows.
        ignored: ['**/art_src/**'],
      },
      proxy: {
        '/ws': { target: `ws://127.0.0.1:${port}`, ws: true },
        '/api': {
          target: `http://127.0.0.1:${port}`,
          // Without this the four calls the client makes on the way in
          // come back 502 and a fresh clone looks broken in the console.
          configure: (proxy) => {
            let told = false;
            proxy.on('error', (_err, req, res) => {
              if (!told) {
                told = true;
                console.log(offlineApiNotice(port));
              }
              if (!('writeHead' in res) || res.headersSent) return;
              const reply = offlineApiReply(req.method);
              res.writeHead(reply.status, reply.type ? { 'content-type': reply.type } : {});
              res.end(reply.body);
            });
          },
        },
      },
    },
    test: {
      // The heaviest tests step whole matches to a result: the endgame run is
      // 20 s of wall clock on its own, and objectives and pacing sit close
      // enough to the 5 s default that a loaded machine fails them for being
      // slow rather than wrong. The bound is here to catch a hang, not to
      // measure the sim.
      testTimeout: 60_000,
    },
  };
});
