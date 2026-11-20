import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import config from '@plone/volto/registry';
import Cookies from 'js-cookie';
import { SET_FRONTEND_PREVIEW_URL } from '../constants';
import { getSavedUrlsCookieName } from '../utils/cookieNames';
import publicUrlSync from './publicUrlSync';

const run = (action) => {
  const next = vi.fn((a) => a);
  publicUrlSync({})(next)(action);
  return next;
};

beforeEach(() => {
  Cookies.set(
    getSavedUrlsCookieName(),
    'A|https://edit.a.example,B|https://edit.b.example|https://www.b.example',
  );
});

afterEach(() => {
  Cookies.remove(getSavedUrlsCookieName());
  config.settings.publicURL = 'http://placeholder';
});

describe('publicUrlSync middleware', () => {
  it('updates settings.publicURL when SET_FRONTEND_PREVIEW_URL fires with a known editUrl (publishUrl wins)', () => {
    run({ type: SET_FRONTEND_PREVIEW_URL, url: 'https://edit.b.example' });
    expect(config.settings.publicURL).toBe('https://www.b.example');
  });

  it('falls back to entry.url when no publishUrl is set', () => {
    run({ type: SET_FRONTEND_PREVIEW_URL, url: 'https://edit.a.example' });
    expect(config.settings.publicURL).toBe('https://edit.a.example');
  });

  it('leaves settings.publicURL alone when the editUrl is unknown', () => {
    config.settings.publicURL = 'http://before';
    run({ type: SET_FRONTEND_PREVIEW_URL, url: 'https://stranger.example' });
    expect(config.settings.publicURL).toBe('http://before');
  });

  it('passes the action through to next() regardless of resolution', () => {
    const next = run({
      type: SET_FRONTEND_PREVIEW_URL,
      url: 'https://edit.b.example',
    });
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0][0].type).toBe(SET_FRONTEND_PREVIEW_URL);
  });

  it('is a no-op for unrelated actions', () => {
    config.settings.publicURL = 'http://before';
    run({ type: 'SOMETHING_ELSE', url: 'https://edit.b.example' });
    expect(config.settings.publicURL).toBe('http://before');
  });
});
