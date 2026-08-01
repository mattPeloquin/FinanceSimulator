import { describe, it, expect } from 'vitest';
import {
  encodeScenarioToShareParam,
  decodeScenarioFromShareParam,
  decodeShareParam,
  buildShareUrl,
  parseScenarioPayload,
  peekShareParamFromUrl,
  stripShareParamFromUrl,
  SHARE_URL_MAX_LENGTH,
  ShareUrlTooLargeError,
} from '../src/state/persistence.js';
import { defaultScenario, SCHEMA_VERSION } from '../src/state/scenario.js';
import { LAB_STATE_VERSION } from '../src/state/migrations.js';
import { FEATURE_SOR_PLAN, FEATURE_SOR_LAB } from '../src/state/storageKeys.js';

describe('share link encode/decode', () => {
  it('round-trips a scenario through gzip + base64url', async () => {
    const scenario = {
      ...defaultScenario(),
      startBalance: 3000,
      baseWithdrawal: 120,
      goalSeekMode: false,
    };
    const param = await encodeScenarioToShareParam(scenario, {
      feature: FEATURE_SOR_PLAN,
      name: 'Test Plan',
      description: 'Shared baseline',
    });
    expect(param).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(param).not.toMatch(/[+/=]/);

    const loaded = await decodeScenarioFromShareParam(param);
    expect(loaded.name).toBe('Test Plan');
    expect(loaded.description).toBe('Shared baseline');
    expect(loaded.feature).toBe(FEATURE_SOR_PLAN);
    expect(loaded.scenario.startBalance).toBe(3000);
    expect(loaded.scenario.baseWithdrawal).toBe(120);
    expect(loaded.scenario.goalSeekMode).toBe(false);
  });

  it('omits empty name, description, and exportedAt from the encoded payload', async () => {
    const param = await encodeScenarioToShareParam({ startBalance: 1000 });
    const padded = param.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    const binary = atob(padded + '='.repeat(padLen));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const json = JSON.parse(new TextDecoder().decode(await new Response(stream).arrayBuffer()));
    expect(json).toEqual({
      type: 'fs-scenario',
      feature: FEATURE_SOR_PLAN,
      stateVersion: SCHEMA_VERSION,
      state: { startBalance: 1000 },
      dependencies: [],
    });
    expect(Object.hasOwn(json, 'name')).toBe(false);
    expect(Object.hasOwn(json, 'description')).toBe(false);
    expect(Object.hasOwn(json, 'exportedAt')).toBe(false);
    expect(Object.hasOwn(json, 'schemaVersion')).toBe(false);
  });

  it('rejects garbage; silently marks legacy uncompressed links', async () => {
    await expect(decodeScenarioFromShareParam('')).rejects.toThrow(/valid simulator scenario link/i);
    await expect(decodeScenarioFromShareParam('%%%')).rejects.toThrow(/valid simulator scenario link/i);

    const ok = await decodeScenarioFromShareParam(await encodeScenarioToShareParam({}));
    expect(ok).toBeTruthy();

    const bad = btoa(JSON.stringify({ type: 'nope', scenario: {} }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    // Uncompressed garbage is treated as legacy (silent clean break).
    expect(await decodeShareParam(bad)).toEqual({ status: 'legacy' });

    const legacyUncompressed = btoa(
      JSON.stringify({
        type: 'sor-scenario',
        schemaVersion: SCHEMA_VERSION,
        scenario: { startBalance: 1 },
      }),
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await decodeShareParam(legacyUncompressed)).toEqual({ status: 'legacy' });
    expect(await decodeScenarioFromShareParam(legacyUncompressed)).toBeNull();
  });

  it('rejects unsupported older schemaVersion the same way as import', async () => {
    const oldPayload = {
      type: 'sor-scenario',
      schemaVersion: 1,
      scenario: { startBalance: 4_000_000, baseWithdrawal: 80_000, numYears: 40 },
    };
    expect(() => parseScenarioPayload(oldPayload)).toThrow(/older than this app supports/i);

    // Legacy share encoding of old schema is silent ignore (not an alert path).
    const param = btoa(JSON.stringify(oldPayload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await decodeShareParam(param)).toEqual({ status: 'legacy' });
  });

  it('buildShareUrl sets s and strip/peek helpers work', async () => {
    const scenario = { startBalance: 2000 };
    const url = await buildShareUrl(scenario, { name: 'A' }, 'https://example.com/app/?x=1#top');
    expect(url).toContain('https://example.com/app/');
    expect(url).toContain('x=1');
    expect(url).toContain('s=');
    expect(peekShareParamFromUrl(url)).toBeTruthy();

    const stripped = stripShareParamFromUrl(url);
    expect(stripped).toBe('/app/?x=1#top');
    expect(peekShareParamFromUrl(`https://example.com${stripped}`)).toBeNull();
  });

  it('rejects share URLs longer than SHARE_URL_MAX_LENGTH', async () => {
    expect(SHARE_URL_MAX_LENGTH).toBe(8000);
    const bloatedBase = `https://example.com/${'x'.repeat(SHARE_URL_MAX_LENGTH)}`;
    await expect(buildShareUrl({ startBalance: 1 }, {}, bloatedBase))
      .rejects.toBeInstanceOf(ShareUrlTooLargeError);
    await expect(buildShareUrl({ startBalance: 1 }, {}, bloatedBase))
      .rejects.toThrow(/too large.*export/i);
  });

  it('round-trips optional ui view settings on share/import envelopes', async () => {
    const ui = {
      theme: 'dark',
      reportBand: { low: 25, high: 75 },
      reportThemeMode: null,
      accordions: { 'section-advanced': true },
      balanceLogScale: true,
    };
    const param = await encodeScenarioToShareParam({ startBalance: 2500 }, { ui });
    const loaded = await decodeScenarioFromShareParam(param);
    expect(loaded.scenario.startBalance).toBe(2500);
    expect(loaded.ui).toEqual(ui);

    const fromParse = parseScenarioPayload({
      type: 'sor-scenario',
      schemaVersion: SCHEMA_VERSION,
      scenario: { startBalance: 1 },
      ui: { theme: 'nope', reportBand: { low: 20, high: 80 } },
    });
    expect(fromParse.ui.theme).toBeNull();
    expect(fromParse.ui.reportBand).toEqual({ low: 20, high: 80 });
    expect(fromParse.feature).toBe(FEATURE_SOR_PLAN);
  });

  it('parses fs-scenario with per-feature stateVersion and dependency versions', () => {
    const parsed = parseScenarioPayload({
      type: 'fs-scenario',
      feature: FEATURE_SOR_LAB,
      stateVersion: LAB_STATE_VERSION,
      state: { version: LAB_STATE_VERSION, sweepPoints: 7 },
      dependencies: [
        {
          feature: FEATURE_SOR_PLAN,
          name: 'Dep',
          stateVersion: SCHEMA_VERSION,
          state: { startBalance: 7 },
        },
      ],
    });
    expect(parsed.feature).toBe(FEATURE_SOR_LAB);
    expect(parsed.state.sweepPoints).toBe(7);
    expect(parsed.dependencies).toHaveLength(1);
    expect(parsed.dependencies[0].name).toBe('Dep');
    expect(parsed.dependencies[0].state.startBalance).toBe(7);
    expect(parsed.dependencies[0].stateVersion).toBe(SCHEMA_VERSION);
  });

  it('rejects fs-scenario missing stateVersion', () => {
    expect(() => parseScenarioPayload({
      type: 'fs-scenario',
      feature: FEATURE_SOR_PLAN,
      state: { startBalance: 42 },
      dependencies: [],
    })).toThrow(/missing or invalid/i);
  });
});
