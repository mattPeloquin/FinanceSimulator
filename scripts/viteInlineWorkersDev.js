// Dev-only: force `?worker&inline` to real blob workers.
//
// Vite's default for `?worker&inline` in `vite serve` is still a module Worker
// pointed at `?worker_file` on the dev server. Those workers share the browser's
// ESM module cache with the page. After enough HMR / full reloads that cache can
// go stale so new workers hang (simulation stuck at 0%) until the browser
// process is killed — restarting Vite alone does not clear it.
//
// We resolve `?worker&inline` to a virtual module (so Vite's built-in worker
// transform never rewrites us) and bundle the worker to an IIFE blob, matching
// production inline behavior and keeping workers off Vite's live module graph.

import esbuild from 'esbuild';
import path from 'path';

const VIRTUAL_PREFIX = '\0dev-inline-worker:';

function parseInlineWorkerImport(id) {
  const queryIndex = id.indexOf('?');
  if (queryIndex === -1) return null;
  const file = id.slice(0, queryIndex);
  const params = new Set(id.slice(queryIndex + 1).split('&'));
  if (!params.has('worker') || params.has('worker_file')) return null;
  if (!params.has('inline')) return null;
  return file;
}

function toAbsoluteEntry(file, importer) {
  if (path.isAbsolute(file)) return path.normalize(file);
  const importerPath = importer ? importer.split('?')[0] : process.cwd();
  // Virtual importer ids are not filesystem paths.
  const baseDir = importerPath.startsWith('\0')
    ? process.cwd()
    : path.dirname(importerPath);
  return path.normalize(path.resolve(baseDir, file));
}

export function inlineWorkersInDev() {
  return {
    name: 'inline-workers-in-dev',
    apply: 'serve',
    enforce: 'pre',
    resolveId(id, importer) {
      const file = parseInlineWorkerImport(id);
      if (!file) return null;
      const absolute = toAbsoluteEntry(file, importer).replace(/\\/g, '/');
      return VIRTUAL_PREFIX + absolute;
    },
    async load(id) {
      if (!id.startsWith(VIRTUAL_PREFIX)) return null;

      const entry = id.slice(VIRTUAL_PREFIX.length);
      this.addWatchFile(entry);

      const result = await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        target: 'esnext',
        metafile: true,
      });

      for (const input of Object.keys(result.metafile.inputs)) {
        this.addWatchFile(path.resolve(input));
      }

      const workerSource = result.outputFiles[0].text;
      return `
export default function WorkerWrapper(options) {
  const blob = new Blob([${JSON.stringify(workerSource)}], {
    type: 'text/javascript;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url, { name: options?.name });
  // Classic workers copy the script during construction; release the blob ASAP.
  URL.revokeObjectURL(url);
  return worker;
}
`;
    },
  };
}
