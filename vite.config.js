import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import handlebars from 'vite-plugin-handlebars';
import { resolve } from 'path';
import fs from 'fs';
import { inlineWorkersInDev } from './scripts/viteInlineWorkersDev.js';
import {
  embedLicenseNotice,
  formatJsBanner,
  readLicenseText,
} from './scripts/licenseNotice.js';

// Helper to get all subdirectories for handlebars partials
function getDirectories(srcPath) {
  return fs.readdirSync(srcPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => resolve(srcPath, dirent.name));
}

const licenseBanner = formatJsBanner(readLicenseText());

export default defineConfig({
  plugins: [
    // Must run before Vite's built-in worker transform so `?worker&inline`
    // becomes a real blob worker in dev (see scripts/viteInlineWorkersDev.js).
    inlineWorkersInDev(),
    handlebars({
      partialDirectory: [
        resolve(__dirname, 'src/partials'),
        ...getDirectories(resolve(__dirname, 'src/partials')),
        resolve(__dirname, 'src/features/sor-plan/partials'),
        ...getDirectories(resolve(__dirname, 'src/features/sor-plan/partials')),
        resolve(__dirname, 'src/features/sor-lab/partials'),
        ...getDirectories(resolve(__dirname, 'src/features/sor-lab/partials')),
        resolve(__dirname, 'src/features/accumulation/partials'),
        ...getDirectories(resolve(__dirname, 'src/features/accumulation/partials')),
        resolve(__dirname, 'src/features/ss-timing/partials'),
        ...getDirectories(resolve(__dirname, 'src/features/ss-timing/partials')),
        resolve(__dirname, 'src/features/roth-convert/partials'),
        ...getDirectories(resolve(__dirname, 'src/features/roth-convert/partials')),
      ],
    }),
    viteSingleFile(),
    // After singlefile: HTML comment in index + closeBundle re-check on dist/.
    embedLicenseNotice(),
  ],
  server: {
    watch: {
      // Test/report output is gitignored but still on disk; without this, Vite
      // full-reloads the app whenever Playwright writes reports and can leave
      // module-worker state half-updated.
      ignored: [
        '**/playwright-report/**',
        '**/test-results/**',
        '**/blob-report/**',
        '**/coverage/**',
        '**/dist/**',
      ],
    },
  },
  build: {
    target: 'esnext',
    // Inline everything (assets + workers) so the output is one portable file.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        // Survives inside the inlined <script> of the single-file build.
        banner: licenseBanner,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
