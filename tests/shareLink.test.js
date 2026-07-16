import { describe, it, expect } from 'vitest';
import {
  encodeScenarioToShareParam,
  decodeScenarioFromShareParam,
  buildShareUrl,
  parseScenarioPayload,
  peekShareParamFromUrl,
  stripShareParamFromUrl,
} from '../src/state/persistence.js';
import { defaultScenario, SCHEMA_VERSION } from '../src/state/scenario.js';

describe('share link encode/decode', () => {
  it('round-trips a scenario through base64url', () => {
    const scenario = {
      ...defaultScenario(),
      startBalance: 3000,
      baseWithdrawal: 120,
      goalSeekMode: false,
    };
    const param = encodeScenarioToShareParam(scenario, {
      name: 'Test Plan',
      description: 'Shared baseline',
    });
    expect(param).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(param).not.toMatch(/[+/=]/);

    const loaded = decodeScenarioFromShareParam(param);
    expect(loaded.name).toBe('Test Plan');
    expect(loaded.description).toBe('Shared baseline');
    expect(loaded.scenario.startBalance).toBe(3000);
    expect(loaded.scenario.baseWithdrawal).toBe(120);
    expect(loaded.scenario.goalSeekMode).toBe(false);
  });

  it('omits empty name, description, and exportedAt from the encoded payload', () => {
    const param = encodeScenarioToShareParam({ startBalance: 1000 });
    const padded = param.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const json = JSON.parse(binary);
    expect(json).toEqual({
      type: 'sor-scenario',
      schemaVersion: SCHEMA_VERSION,
      scenario: { startBalance: 1000 },
    });
    expect(Object.hasOwn(json, 'name')).toBe(false);
    expect(Object.hasOwn(json, 'description')).toBe(false);
    expect(Object.hasOwn(json, 'exportedAt')).toBe(false);
  });

  it('rejects garbage and wrong type', () => {
    expect(() => decodeScenarioFromShareParam('')).toThrow(/valid simulator scenario link/i);
    expect(() => decodeScenarioFromShareParam('%%%')).toThrow(/valid simulator scenario link/i);
    expect(() => decodeScenarioFromShareParam(encodeScenarioToShareParam({}))).not.toThrow();

    const bad = btoa(JSON.stringify({ type: 'nope', scenario: {} }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(() => decodeScenarioFromShareParam(bad)).toThrow(/valid simulator scenario link/i);
  });

  it('migrates older schemaVersion the same way as import', () => {
    const v1Payload = {
      type: 'sor-scenario',
      schemaVersion: 1,
      scenario: { startBalance: 4_000_000, baseWithdrawal: 80_000, numYears: 40 },
    };
    const fromParse = parseScenarioPayload(v1Payload);
    expect(fromParse.scenario.startBalance).toBe(4000);
    expect(fromParse.scenario.baseWithdrawal).toBe(80);

    const param = btoa(JSON.stringify(v1Payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const fromShare = decodeScenarioFromShareParam(param);
    expect(fromShare.scenario.startBalance).toBe(fromParse.scenario.startBalance);
    expect(fromShare.scenario.baseWithdrawal).toBe(fromParse.scenario.baseWithdrawal);
  });

  it('buildShareUrl sets s and strip/peek helpers work', () => {
    const scenario = { startBalance: 2000 };
    const url = buildShareUrl(scenario, { name: 'A' }, 'https://example.com/app/?x=1#top');
    expect(url).toContain('https://example.com/app/');
    expect(url).toContain('x=1');
    expect(url).toContain('s=');
    expect(peekShareParamFromUrl(url)).toBeTruthy();

    const stripped = stripShareParamFromUrl(url);
    expect(stripped).toBe('/app/?x=1#top');
    expect(peekShareParamFromUrl(`https://example.com${stripped}`)).toBeNull();
  });
});
