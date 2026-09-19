import { jest } from '@jest/globals';
import { JSDOM } from 'jsdom';
import { connectProxy } from './hydra.src.js';

/**
 * The proxy frame must be told which CMS it serves.
 *
 * It used to fall back to window.location.origin — the FRONTEND's origin. That
 * is only the CMS when the CMS happens to serve the frontend (a Plone classic
 * site); for every headless frontend it pointed the adapter at the site itself,
 * and the failure surfaced later as 404s from the wrong server.
 */
describe('connectProxy — cmsBaseUrl', () => {
  let prev;
  const adapter = () => ({
    name: 'stub',
    capabilities: [],
    init: jest.fn(async () => {}),
    whoami: jest.fn(async () => null),
    dispatch: jest.fn(),
  });

  beforeEach(() => {
    const { window } = new JSDOM('<!DOCTYPE html><body></body>', {
      url: 'http://frontend.test/hydra-proxy.html',
    });
    window.name = 'hydra-proxy:http://admin.test';
    prev = { window: globalThis.window, document: globalThis.document };
    globalThis.window = window;
    globalThis.document = window.document;
  });

  afterEach(() => {
    globalThis.window = prev.window;
    globalThis.document = prev.document;
  });

  test('fails loudly when no cmsBaseUrl is given', () => {
    expect(() => connectProxy(adapter(), {})).toThrow(/cmsBaseUrl/);
  });

  test('initialises the adapter against the given CMS', async () => {
    const a = adapter();
    const bridge = connectProxy(a, { cmsBaseUrl: 'http://cms.test' });
    await bridge.ready;
    expect(a.init).toHaveBeenCalledWith(
      expect.objectContaining({ cmsBaseUrl: 'http://cms.test' }),
    );
  });
});
