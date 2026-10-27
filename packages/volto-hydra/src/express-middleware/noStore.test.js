import { noStore } from './noStore';

// A stand-in for an Express response: the header store, and setHeader as Node
// defines it (Express's res.set goes through setHeader).
function fakeResponse() {
  const headers = {};
  return {
    headers,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
  };
}

describe('noStore', () => {
  it('marks the response no-store and passes it on', () => {
    const res = fakeResponse();
    const next = vi.fn();
    noStore({}, res, next);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('keeps no-store when a later handler sets its own Cache-Control', () => {
    // Volto's error page asks for `public, max-age=60`: a shared cache would
    // then keep an error page, a 500 during a deploy, for everyone.
    const res = fakeResponse();
    noStore({}, res, () => {});
    res.setHeader('Cache-Control', 'public, max-age=60, no-transform');
    expect(res.headers['cache-control']).toBe('no-store');
    res.setHeader('cache-control', 'no-cache');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('leaves every other header alone', () => {
    const res = fakeResponse();
    noStore({}, res, () => {});
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
  });
});
