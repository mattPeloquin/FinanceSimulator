import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import handlebars from 'vite-plugin-handlebars';
import { resolve } from 'path';
import fs from 'fs';

// Helper to get all subdirectories for handlebars partials
function getDirectories(srcPath) {
  return fs.readdirSync(srcPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => resolve(srcPath, dirent.name));
}

export default defineConfig({
  plugins: [
    handlebars({
      partialDirectory: [
        resolve(__dirname, 'src/partials'),
        ...getDirectories(resolve(__dirname, 'src/partials'))
      ],
    }),
    viteSingleFile()
  ],
  build: {
    target: 'esnext',
    // Inline everything (assets + workers) so the output is one portable file.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    reportCompressedSize: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
