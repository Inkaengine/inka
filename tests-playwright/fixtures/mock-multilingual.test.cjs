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

  it('keeps the fields it was sent, not just the ones it expected', async () => {
    // A language-independent field is carried over by the add form rather than
    // typed again, so nothing in the UI would notice the create silently
    // dropping it: the form showed the inherited tags, the POST carried them,
    // and reading the page back said there were none. Plone stores whatever the
    // type's schema has, and so does this.
    const token = 'carry-fields-token';
    const created = await json('/de', {
      method: 'POST',
      token,
      body: {
        '@type': 'Document',
        title: 'Dienstleistungen',
        subjects: ['design', 'build'],
      },
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.data.subjects, ['design', 'build']);

    const back = await json('/de/dienstleistungen', { token });
    assert.deepEqual(
      back.data.subjects,
      ['design', 'build'],
      'the field survived the round trip, not just the create response',
    );
  });

  it('ignores what the server computes, however the client sent it', async () => {
    // Keeping the posted fields must not mean keeping ALL of them. Volto's add
    // form carries `parent` in its form data, and on a translation that parent
    // is the page being translated FROM — so storing it put the German page's
    // parent at /en/services, which is where breadcrumbs, navigation and the
    // navroot all read from.
    const token = 'computed-fields-token';
    await asMultilingual(token);

    const created = await json('/de', {
      method: 'POST',
      token,
      body: {
        '@type': 'Document',
        title: 'Dienstleistungen',
        translation_of: '/en/services',
        language: 'de',
        parent: { '@id': '/en/services' },
      },
    });
    assert.equal(created.status, 201);
    assert.ok(
      !created.data.parent['@id'].includes('/en/'),
      `the parent is not the page it was translated from, got ${created.data.parent['@id']}`,
    );

    const back = await json('/de/dienstleistungen', { token });
    assert.ok(
      !back.data.parent['@id'].includes('/en/'),
      `and still is not on the way back, got ${back.data.parent['@id']}`,
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

describe('a language is a tree of its own', () => {
  it('roots navigation at the language folder, not the site', async () => {
    // plone.app.multilingual gives each language root folder its own navroot,
    // which is what stops a menu listing the site in two languages at once.
    const { data } = await json('/en/about?expand=navroot');
    assert.ok(
      data['@components'].navroot.navroot['@id'].endsWith('/en'),
      `expected /en as the navroot, got ${data['@components'].navroot.navroot['@id']}`,
    );
  });

  it('offers a language its OWN pages in the menu', async () => {
    const { data } = await json('/en/about?expand=navigation');
    const titles = data['@components'].navigation.items.map((i) => i.title);
    assert.deepEqual(titles.sort(), ['About us', 'Services', 'Team']);

    const german = await json('/de/ueber-uns?expand=navigation');
    assert.deepEqual(
      german.data['@components'].navigation.items.map((i) => i.title).sort(),
      ['Dienstleistungen', 'Über uns'],
    );
  });

  it('leaves a single-language site rooted where it always was', async () => {
    // The rest of the suite shares this server: outside a language folder
    // nothing changes.
    const { data } = await json('/_test_data/test-page?expand=navroot,navigation');
    assert.equal(
      new URL(data['@components'].navroot.navroot['@id']).pathname,
      '/',
    );
    const titles = data['@components'].navigation.items.map((i) => i.title);
    assert.ok(titles.includes('Test Data'), `expected the site menu, got ${titles}`);
  });

  it('searches within one language, not across all of them', async () => {
    const { data } = await json(
      '/@search?path.query=/en&path.depth=1&metadata_fields=language',
    );
    const paths = data.items.map((i) => new URL(i['@id']).pathname);
    assert.ok(paths.length > 0, 'the English tree has pages');
    assert.ok(
      paths.every((p) => p.startsWith('/en/')),
      `expected only English pages, got ${paths}`,
    );
  });
});

describe('language-independent fields', () => {
  it('says which fields a translation inherits rather than translates', async () => {
    // Plone marks a field language-independent in its schema, and
    // plone.restapi serialises that as multilingual_options. Volto reads it to
    // copy the value from the original instead of asking for a translation of
    // it, and to show the field as inherited. Tags are the classic case: the
    // same tag means the same thing in every language.
    const { status, data } = await json('/@types/Document');
    assert.equal(status, 200);
    assert.equal(
      data.properties.subjects?.multilingual_options?.language_independent,
      true,
    );
    assert.notEqual(
      data.properties.title?.multilingual_options?.language_independent,
      true,
      'a title is translated, not inherited',
    );
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

describe('translating something that is not a page', () => {
  // A site is not only Documents. plone.app.multilingual translates whatever
  // the type is — a folder, an image, a file — and the create path is the same
  // one: `translation_of` says which group to join, `language` says which
  // language the new item is. A create that honours those for Documents alone
  // saves the others unlinked and language-less, and says nothing about it.
  for (const [type, body] of [
    ['Folder', { title: 'Dienste' }],
    ['Image', { title: 'Logo', image: { filename: 'logo.png', 'content-type': 'image/png' } }],
    ['File', { title: 'Preisliste', file: { filename: 'preise.pdf' } }],
  ]) {
    it(`links a ${type} to the item it translates`, async () => {
      const token = `translate-${type}-token`;
      await asMultilingual(token);

      // Something in English to translate: the same create path, untranslated.
      const original = await json('/en', {
        method: 'POST',
        token,
        body: { '@type': type, ...body },
      });
      assert.equal(original.status, 201);
      const originalPath = new URL(original.data['@id']).pathname;

      const translation = await json('/de', {
        method: 'POST',
        token,
        body: {
          '@type': type,
          ...body,
          translation_of: originalPath,
          language: 'de',
        },
      });
      assert.equal(translation.status, 201);
      assert.equal(
        typeof translation.data.language === 'object'
          ? translation.data.language.token
          : translation.data.language,
        'de',
        `a translated ${type} knows which language it is`,
      );

      const group = await json(`${originalPath}/@translations`, { token });
      assert.equal(group.status, 200);
      assert.deepEqual(
        group.data.items.map((i) => i.language),
        ['de'],
        `the ${type} it was translated from lists it`,
      );
    });
  }

  it('gives a folder a path from its title, as it does a page', async () => {
    const token = 'folder-id-token';
    const created = await json('/de', {
      method: 'POST',
      token,
      body: { '@type': 'Folder', title: 'Mannschaft' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.id, 'mannschaft');
  });

  it('refuses a translation_of that names nothing, rather than saving it loose', async () => {
    // Silently dropping the link is the worst outcome: the editor is told the
    // translation was created, and it belongs to no group.
    const token = 'bad-translation-of-token';
    await asMultilingual(token);

    const { status } = await json('/de', {
      method: 'POST',
      token,
      body: { '@type': 'Document', title: 'Waise', translation_of: '/en/nonesuch' },
    });
    assert.equal(status, 400);
  });
});

describe('an image is content too', () => {
  it('serves the English image, and can translate it', async () => {
    // The fixture pair so far is pages. An image is the other thing a site is
    // made of, and it translates the same way: a German image joins the
    // English one's group, and is a separate file.
    const token = 'image-translate-token';
    await asMultilingual(token);

    const original = await json('/en/logo.jpg', { token });
    assert.equal(original.status, 200);
    assert.equal(original.data['@type'], 'Image');

    const created = await json('/de', {
      method: 'POST',
      token,
      body: {
        '@type': 'Image',
        title: 'Logo',
        image: { filename: 'logo-de.png', 'content-type': 'image/png' },
        translation_of: '/en/logo.jpg',
        language: 'de',
      },
    });
    assert.equal(created.status, 201);

    const group = await json('/en/logo.jpg/@translations', { token });
    assert.deepEqual(
      group.data.items.map((i) => i.language),
      ['de'],
      'the English image lists its German counterpart',
    );
  });
});

describe('the Language index', () => {
  // How Plone actually keeps the languages apart. Language root folders and a
  // navigation root per language separate what is BROWSED; the catalog's
  // `Language` index separates what is FOUND — p.a.m. filters searches by
  // language, and `Language=all` opts out. Scoping by path alone is not the
  // same mechanism: it agrees only as long as every item sits under its own
  // language folder, and says nothing about a search made from the site root.
  it('answers a search in one language with that language only', async () => {
    const token = 'language-index-token';
    await asMultilingual(token);

    const { status, data } = await json('/@search?Language=de&path.depth=2', {
      token,
    });
    assert.equal(status, 200);
    assert.ok(data.items.length > 0, 'there is German content to find');
    // Searched from the SITE ROOT, so a path-scoped answer would have included
    // the English tree: this is the index doing the work, not the path.
    for (const item of data.items) {
      assert.ok(
        new URL(item['@id']).pathname.startsWith('/de'),
        `${item['@id']} is not German`,
      );
    }
  });

  it('answers everything when asked for Language=all, as the catalog does', async () => {
    const token = 'language-all-token';
    await asMultilingual(token);

    const scoped = await json('/@search?Language=de&path.depth=2', { token });
    const all = await json('/@search?Language=all&path.depth=2', { token });
    assert.ok(
      all.data.items.length > scoped.data.items.length,
      `all (${all.data.items.length}) must be more than one language (${scoped.data.items.length})`,
    );
  });

  it('leaves a search alone when it does not ask about language', async () => {
    // Every other spec in this suite is a single-language site searching
    // without a Language term; it must keep getting what it always got.
    const { data } = await json('/@search?path.depth=2');
    assert.ok(data.items.length > 0);
  });
});
