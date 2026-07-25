// Embed the project MIT notice into HTML/JS so shared single-file builds
// carry the copyright + permission text even when only dist/index.html is copied.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_LICENSE_PATH = path.resolve(__dirname, '..', 'LICENSE');

/** Stable marker so injectors stay idempotent across rebuilds. */
export const LICENSE_MARKER = 'Finance Simulator — MIT License';

/**
 * @param {string} [licensePath]
 * @returns {string}
 */
export function readLicenseText(licensePath = DEFAULT_LICENSE_PATH) {
  return fs.readFileSync(licensePath, 'utf8').replace(/\r\n/g, '\n').trimEnd();
}

/**
 * @param {string} licenseText
 * @returns {string}
 */
export function formatHtmlComment(licenseText) {
  const body = String(licenseText).trimEnd();
  // HTML comments must not contain "--"; LICENSE text is plain MIT prose.
  return `<!--\n  ${LICENSE_MARKER}\n  SPDX-License-Identifier: MIT\n\n${body}\n-->`;
}

/**
 * @param {string} licenseText
 * @returns {string}
 */
export function formatJsBanner(licenseText) {
  const body = String(licenseText)
    .trimEnd()
    .split('\n')
    .map((line) => ` * ${line}`.replace(/\s+$/, ''))
    .join('\n');
  return `/*!\n * ${LICENSE_MARKER}\n * SPDX-License-Identifier: MIT\n *\n${body}\n */\n`;
}

/**
 * Prepend the HTML license comment when missing; replace a prior copy when present.
 * @param {string} html
 * @param {string} licenseText
 * @returns {string}
 */
export function ensureHtmlLicenseComment(html, licenseText) {
  const comment = formatHtmlComment(licenseText);
  const withoutPrior = String(html).replace(
    /<!--\s*\n?\s*Finance Simulator — MIT License[\s\S]*?-->\s*/m,
    '',
  );
  // Keep a leading doctype on its own line when present.
  if (/^\s*<!DOCTYPE/i.test(withoutPrior)) {
    return withoutPrior.replace(/^(\s*<!DOCTYPE[^>]*>\s*)/i, `$1${comment}\n`);
  }
  return `${comment}\n${withoutPrior}`;
}

/**
 * Vite plugin: inject MIT notice into index HTML (dev + build) and into dist.
 * Pair with rollup `output.banner` from {@link formatJsBanner}.
 */
export function embedLicenseNotice(options = {}) {
  const licensePath = options.licensePath || DEFAULT_LICENSE_PATH;
  let licenseText = '';

  return {
    name: 'embed-license-notice',
    buildStart() {
      licenseText = readLicenseText(licensePath);
      this.addWatchFile(licensePath);
    },
    transformIndexHtml(html) {
      if (!licenseText) licenseText = readLicenseText(licensePath);
      return ensureHtmlLicenseComment(html, licenseText);
    },
    closeBundle() {
      if (!licenseText) licenseText = readLicenseText(licensePath);
      const outDir = path.resolve(options.outDir || 'dist');
      const htmlPath = path.join(outDir, 'index.html');
      if (!fs.existsSync(htmlPath)) return;
      const html = fs.readFileSync(htmlPath, 'utf8');
      const next = ensureHtmlLicenseComment(html, licenseText);
      if (next !== html) fs.writeFileSync(htmlPath, next, 'utf8');
    },
  };
}
