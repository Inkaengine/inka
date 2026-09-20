const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('./mock-api-server.cjs');

/**
 * The multilingual API, as plone.app.multilingual serves it.
 *
 * Language root folders at the site root, each item carrying its language and
 * the translations linked to it. The admin's Manage Translations and Create
 * Translation views are Volto's own — they work against this shape or not at
 * all, so the mock reproduces it rather than an easier one:
 *
 *   GET  /en/about/@translations                      what it is linked to
 *   POST /en/about/@translations {id}                 link an existing page
 *   DEL  /en/about/@translations {language}           unlink one
 *   GET  /en/x/@translation-locator?target_language=de  where a translation goes
 *   POST /de {translation_of, language}               create one, already linked
 *
 * The site advertises `features.multilingual` per SESSION (the mock keys state
 * by auth token). A site-wide flag would turn Volto's `/` redirect, its extra
 * `translations` expander and its toolbar entry on for every other spec in the
 * suite, and parallel workers would race each other through one global.
 */

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

const json = async (path, options = {}) => {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
};

const asMultilingual = async (token) => {
  const { status } = await json('/@mock-site-features', {
    method: 'POST',
    token,
    body: { multilingual: true, languages: ['en', 'de'] },
  });
  assert.equal(status, 200);
};

describe('language root folders', () => {
  it('serves one folder per language at the site root', async () => {
    for (const [lang, title] of [['en', 'English'], ['de', 'Deutsch']]) {
      const { status, data } = await json(`/${lang}`);
      assert.equal(status, 200, `/${lang} must exist`);
      assert.equal(data.is_folderish, true, `/${lang} is a folder`);
      assert.equal(data.language.token, lang);
      assert.equal(data.title, title);
    }
  });

  it('gives a page its language as Plone does, a token and a title', async () => {
    const { data } = await json('/en/about');
    assert.equal(data.language.token, 'en');
    assert.equal(typeof data.language.title, 'string');
  });
});

describe('@translations', () => {
  it('lists what a page is linked to, both ways', async () => {
    const en = await json('/en/about/@translations');
    assert.equal(en.status, 200);
    assert.deepEqual(
      en.data.items.map((i) => i.language),
      ['de'],
    );
    assert.ok(en.data.items[0]['@id'].endsWith('/de/ueber-uns'));

    const de = await json('/de/ueber-uns/@translations');
    assert.deepEqual(
      de.data.items.map((i) => i.language),
      ['en'],
    );
  });

  it('expands onto the content, which is where Volto reads it', async () => {
    const { data } = await json('/en/about?expand=translations');
    const items = data['@components'].translations.items;
    assert.equal(items.length, 1);
    assert.equal(items[0].language, 'de');
  });

  it('links and unlinks a page, in this session only', async () => {
    const token = 'link-test-token';
    await asMultilingual(token);

    const linked = await json('/en/services/@translations', {
      method: 'POST',
      token,
      body: { id: '/de/dienstleistungen' },
    });
    assert.equal(linked.status, 201);

    const after = await json('/en/services/@translations', { token });
    assert.deepEqual(
      after.data.items.map((i) => i.language),
      ['de'],
    );

    // Another session never saw the link.
    const elsewhere = await json('/en/services/@translations', {
      token: 'other-token',
    });
    assert.deepEqual(elsewhere.data.items, []);

    const unlinked = await json('/en/services/@translations', {
      method: 'DELETE',
      token,
      body: { language: 'de' },
    });
    assert.equal(unlinked.status, 204);
    const gone = await json('/en/services/@translations', { token });
    assert.deepEqual(gone.data.items, []);
  });
});

describe('@translation-locator', () => {
  it('names the folder a translation belongs in', async () => {
    const { status, data } = await json(
      '/en/services/@translation-locator?target_language=de',
    );
    assert.equal(status, 200);
    assert.ok(
      data['@id'].endsWith('/de'),
      `expected the German root folder, got ${data['@id']}`,
    );
  });
});

describe('creating a translation', () => {
  it('creates the page already linked to its original', async () => {
    const token = 'create-test-token';
    await asMultilingual(token);

    const { data: original } = await json('/en/services', { token });
    const created = await json('/de', {
      method: 'POST',
      token,
      body: {
        '@type': 'Document',
        id: 'dienstleistungen-neu',
        title: 'Dienstleistungen',
        translation_of: original.UID,
        language: 'de',
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.language.token, 'de');

    const back = await json('/en/services/@translations', { token });
    assert.deepEqual(
      back.data.items.map((i) => i.language),
      ['de'],
    );
    assert.ok(back.data.items[0]['@id'].endsWith('/de/dienstleistungen-neu'));
  });

  it("accepts the original's PATH, which is what Volto sends", async () => {
    // Volto's add form passes flattenToAppURL(content['@id']) as
    // translation_of, a path — while plone.app.multilingual's own examples use
    // a UID. A mock that took only the UID accepted nothing the real client
    // sends, and the page saved unlinked.
    const token = 'create-by-path-token';
    await asMultilingual(token);

    const created = await json('/de', {
      method: 'POST',
      token,
      body: {
        '@type': 'Document',
        title: 'Über alles',
        translation_of: '/en/about',
        language: 'de',
      },
    });
    assert.equal(created.status, 201);

    const back = await json('/en/about/@translations', { token });
    assert.ok(
      back.data.items.some((i) => i['@id'].endsWith('/de/uber-alles')),
      'the new German page joined the English page\'s translation group',
    );
  });

  it('derives the id from the title, as Plone does when none is sent', async () => {
    const token = 'id-from-title-token';
    const created = await json('/de', {
      method: 'POST',
      token,
      body: { '@type': 'Document', title: 'Grüße und Küsse' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.id, 'grusse-und-kusse');
  });
});

describe('@site features.multilingual', () => {
  it('is off by default, so the rest of the suite is a single-language site', async () => {
    const { data } = await json('/@site');
    assert.notEqual(data.features?.multilingual, true);
  });

  it('is on for a session that asked, and lists its languages', async () => {
    const token = 'site-features-token';
    await asMultilingual(token);
    const { data } = await json('/@site', { token });
    assert.equal(data.features.multilingual, true);
    assert.deepEqual(data['plone.available_languages'], ['en', 'de']);
  });
});
