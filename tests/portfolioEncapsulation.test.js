import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { segmentIdentifierPatterns, listSleeves } from '../src/portfolio/registry.js';
import { historicalData } from '../src/portfolio/historicalData.js';
import { assertHistoryAligned, sampleYearReturn, buildMarketParams, defaultPortfolio } from '../src/portfolio/api.js';
import { createRng } from '../src/core/rng.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

/** Paths under src/ that may still mention segment identifiers. */
const ALLOW_PREFIXES = [
  'src/portfolio/',
  'src/state/presets/', // JSON data loaded via portfolio-aware preset helpers
  'src/data/historicalData.js', // re-export only
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(js|html|mdc)$/.test(name)) out.push(full);
  }
  return out;
}

function isAllowed(rel) {
  const norm = rel.replace(/\\/g, '/');
  return ALLOW_PREFIXES.some((p) => norm === p || norm.startsWith(p));
}

describe('portfolio encapsulation', () => {
  it('aligns every historical year with registry history keys', () => {
    expect(() => assertHistoryAligned(historicalData)).not.toThrow();
  });

  it('does not hard-code segment identifiers outside allowlisted paths', () => {
    // Skip bare "inflation" / short tokens that appear in unrelated UX copy.
    const patterns = segmentIdentifierPatterns().filter((p) => p.length >= 4);
    const longPatterns = patterns.filter(
      (p) =>
        p !== 'inflation'
        && (p.length >= 8 || p.includes('_') || p.includes('Allocation') || p.includes('Mean') || p.includes('Std')),
    );
    const files = walk(join(root, 'src'));
    const offenders = [];
    for (const file of files) {
      const rel = relative(root, file).replace(/\\/g, '/');
      if (isAllowed(rel)) continue;
      const text = readFileSync(file, 'utf8');
      for (const id of longPatterns) {
        if (text.includes(id)) {
          offenders.push(`${rel} → ${id}`);
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('sampleYearReturn works for registry-length portfolios (N-sleeve smoke)', () => {
    const portfolio = defaultPortfolio();
    const market = buildMarketParams(portfolio, { horizonYears: 5 });
    const rng = createRng(42);
    const state = { bootIndex: -1, lnPrevZ: null };
    const { realReturn } = sampleYearReturn(
      market,
      rng,
      market.allocation,
      0,
      state,
    );
    expect(Number.isFinite(realReturn)).toBe(true);
    expect(listSleeves().length).toBeGreaterThan(0);
  });
});
