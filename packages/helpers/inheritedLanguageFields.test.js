import { describe, it, expect } from 'vitest';
import { inheritedLanguageFields } from './index.js';

/**
 * Which fields this page inherits rather than owns.
 *
 * A language-independent field is one value shared by a translation group, so
 * it needs one home. The home is the page in the site's default language; the
 * translations show it and send the editor there. Volto only does this while a
 * translation is being CREATED (its `babel-view` class is set in Add.jsx alone)
 * and lets the same field be typed into on every translation afterwards, which
 * offers as many homes as there are languages.
 *
 * A page in another language that is nobody's translation is not inheriting
 * anything — it owns its own value.
 */
const schema = {
  properties: {
    title: { title: 'Title', type: 'string' },
    subjects: {
      title: 'Tags',
      type: 'array',
      multilingual_options: { language_independent: true },
    },
    rights: {
      title: 'Rights',
      type: 'string',
      multilingual_options: { language_independent: true },
    },
  },
};

const translated = (language) => ({
  language: { token: language, title: language },
  '@components': {
    translations: { items: [{ '@id': '/en/about', language: 'en' }] },
  },
});

describe('inheritedLanguageFields', () => {
  it('names them on a translation, so the form can show them as inherited', () => {
    expect(inheritedLanguageFields(schema, translated('de'), 'en')).toEqual([
      'subjects',
      'rights',
    ]);
  });

  it('names none on the page in the default language — the value lives there', () => {
    expect(inheritedLanguageFields(schema, translated('en'), 'en')).toEqual([]);
  });

  it('names none on a page that is nobody\'s translation', () => {
    const standalone = {
      language: { token: 'de', title: 'de' },
      '@components': { translations: { items: [] } },
    };
    expect(inheritedLanguageFields(schema, standalone, 'en')).toEqual([]);
  });

  it('reads a language given as a plain string, as some responses send it', () => {
    expect(
      inheritedLanguageFields(
        { ...schema },
        { language: 'de', '@components': { translations: { items: [{}] } } },
        'en',
      ),
    ).toEqual(['subjects', 'rights']);
  });

  it('says nothing when it cannot tell — no content, no schema, no site language', () => {
    expect(inheritedLanguageFields(schema, translated('de'), undefined)).toEqual([]);
    expect(inheritedLanguageFields(schema, null, 'en')).toEqual([]);
    expect(inheritedLanguageFields(null, translated('de'), 'en')).toEqual([]);
    // A single-language site never expands `translations` at all.
    expect(
      inheritedLanguageFields(schema, { language: { token: 'de' } }, 'en'),
    ).toEqual([]);
  });
});
