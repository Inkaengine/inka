import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import type { Page } from '@playwright/test';
import { AdminUIHelper } from './AdminUIHelper';
import { HARNESS_OFFSETS } from '../ports';

/**
 * The admin's address is read when a test uses it, not when the helper is
 * made. Block sanity makes a helper for every test and drives the mock parent,
 * never the admin, so a suite that sets no admin port must still run.
 */
const fakePage = () => ({ on: () => {}, addInitScript: async () => {} }) as unknown as Page;

describe('AdminUIHelper adminUrl', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    for (const name of Object.keys(process.env)) {
      if (name.startsWith('HYDRA_') && name.endsWith('_PORT')) delete process.env[name];
    }
    delete process.env.HYDRA_PORT_BASE;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  test('a helper is made without any admin port', () => {
    expect(() => new AdminUIHelper(fakePage())).not.toThrow();
  });

  test('using the address nobody gave says so', () => {
    const helper = new AdminUIHelper(fakePage());
    expect(() => helper.adminUrl).toThrow(/HYDRA_PORT_BASE/);
  });

  test('the address given wins', () => {
    expect(new AdminUIHelper(fakePage(), 'https://admin.example.org').adminUrl).toBe('https://admin.example.org');
  });

  test('without one, the harness Volto from the port block', () => {
    process.env.HYDRA_PORT_BASE = '9000';
    expect(new AdminUIHelper(fakePage()).adminUrl).toBe(`http://localhost:${9000 + HARNESS_OFFSETS.voltoSsr}`);
  });
});
