/**
 * Which of a page's own links lead nowhere, decided without rendering them.
 *
 * Fetching a link from the frontend renders the page it points at, and a page's
 * links are mostly the site chrome: measured on one docs site, 84 pages held
 * 7,027 same-origin links to 215 targets, so checking each page's links on the
 * frontend rendered most pages of the site again for every page tested. That
 * was most of the cost of a page-integrity run, and with tests in parallel it
 * was enough load to time the checks out.
 *
 * Almost every link is to content, and whether content exists is the API's
 * answer: one JSON read, no render. So each target is asked of the API first.
 * What the API doesn't hold is asked of the frontend, as before: a frontend
 * route with no content behind it, a static file, a typo. A link neither can
 * serve is dead.
 *
 * Each target is asked once per checker and the answer kept, so the chrome's
 * links cost one request each for the whole run, while every page that holds a
 * dead link still reports it.
 */

/** Answers a same-origin path (with its query) with an HTTP status, or throws if it cannot. */
export type AskStatus = (path: string) => Promise<number>;

/**
 * The content path a link shows: its query picks a view of that content, and a
 * listing's page segment (`/@pg_<block>_<n>`, the paging route the frontends
 * draw, see hydra.src.js) is a frontend route over the same content.
 */
export function contentPathOf(href: string): string {
  const path = href.split('?')[0].split('#')[0];
  const kept = path.split('/').filter((segment) => !segment.startsWith('@pg_'));
  return kept.join('/') || '/';
}

/**
 * A checker for one run: give it each page's same-origin hrefs (path + query),
 * get back the dead ones as `<href> -> <why>`, sorted.
 */
export function createLinkChecker({
  askApi,
  askFrontend,
}: {
  askApi: AskStatus;
  askFrontend: AskStatus;
}): (hrefs: string[]) => Promise<string[]> {
  const api = new Map<string, Promise<number>>();
  const frontend = new Map<string, Promise<string | null>>();

  const once = <T>(cache: Map<string, Promise<T>>, key: string, ask: () => Promise<T>): Promise<T> => {
    let answer = cache.get(key);
    if (!answer) {
      answer = ask();
      cache.set(key, answer);
    }
    return answer;
  };

  /** Why `href` is dead, or null if it leads somewhere. */
  const deadBecause = async (href: string): Promise<string | null> => {
    const content = contentPathOf(href);
    if ((await once(api, content, () => askApi(content))) < 400) return null;
    return once(frontend, href, async () => {
      try {
        const status = await askFrontend(href);
        return status >= 400 ? `HTTP ${status}` : null;
      } catch (e) {
        // A request that cannot complete is a defect worth seeing, not a pass.
        return (e as Error).message;
      }
    });
  };

  return async (hrefs) => {
    const why = await Promise.all(hrefs.map(async (href) => [href, await deadBecause(href)] as const));
    return why
      .filter(([, because]) => because !== null)
      .map(([href, because]) => `${href} -> ${because}`)
      .sort();
  };
}
