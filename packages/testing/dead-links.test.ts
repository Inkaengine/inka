import { describe, expect, it } from 'vitest';

import { contentPathOf, createLinkChecker } from './dead-links';

/** A fake host: answers each path from `statuses` (404 if absent) and records what it was asked. */
function host(statuses: Record<string, number>) {
  const asked: string[] = [];
  return {
    asked,
    ask: async (path: string) => {
      asked.push(path);
      return statuses[path] ?? 404;
    },
  };
}

describe('contentPathOf', () => {
  it('drops the query: it picks a view of the content, not the content', () => {
    expect(contentPathOf('/news?b_start=10')).toBe('/news');
  });

  it("drops a listing's page segment: /@pg_<block>_<n> is a frontend route over the same content", () => {
    expect(contentPathOf('/components/search/@pg_s-extab-0-b1_2')).toBe('/components/search');
    expect(contentPathOf('/@pg_b1_3')).toBe('/');
  });

  it('keeps every other path as it is', () => {
    expect(contentPathOf('/components/card')).toBe('/components/card');
    expect(contentPathOf('/')).toBe('/');
  });
});

describe('createLinkChecker', () => {
  it('asks the API about a content link and never makes the frontend render it', async () => {
    const api = host({ '/components/card': 200 });
    const frontend = host({});
    const check = createLinkChecker({ askApi: api.ask, askFrontend: frontend.ask });

    expect(await check(['/components/card'])).toEqual([]);
    expect(api.asked).toEqual(['/components/card']);
    expect(frontend.asked).toEqual([]);
  });

  it("asks the frontend only about what the API doesn't hold, and reports it dead if the frontend can't serve it either", async () => {
    const api = host({});
    const frontend = host({ '/favicon.ico': 200 });
    const check = createLinkChecker({ askApi: api.ask, askFrontend: frontend.ask });

    expect(await check(['/favicon.ico', '/components/sections'])).toEqual([
      '/components/sections -> HTTP 404',
    ]);
    expect(frontend.asked.sort()).toEqual(['/components/sections', '/favicon.ico']);
  });

  it("checks a paging link against the API as its page's content", async () => {
    const api = host({ '/components/search': 200 });
    const frontend = host({});
    const check = createLinkChecker({ askApi: api.ask, askFrontend: frontend.ask });

    expect(await check(['/components/search/@pg_s-extab-0-b1_2'])).toEqual([]);
    expect(api.asked).toEqual(['/components/search']);
    expect(frontend.asked).toEqual([]);
  });

  it('asks once per target across pages, but reports a dead link on every page that has it', async () => {
    const api = host({ '/a': 200 });
    const frontend = host({});
    const check = createLinkChecker({ askApi: api.ask, askFrontend: frontend.ask });

    expect(await check(['/a', '/gone'])).toEqual(['/gone -> HTTP 404']);
    expect(await check(['/a', '/gone', '/a?x=1'])).toEqual(['/gone -> HTTP 404']);
    expect(api.asked).toEqual(['/a', '/gone']);
    expect(frontend.asked).toEqual(['/gone']);
  });

  it('reports a request that cannot complete as dead, with its error', async () => {
    const check = createLinkChecker({
      askApi: async () => 404,
      askFrontend: async () => {
        throw new Error('fetch failed');
      },
    });

    expect(await check(['/x'])).toEqual(['/x -> fetch failed']);
  });
});
