import { describe, it, expect } from 'vitest';
import {
  translationsAreGrouped,
  canTranslate,
  canLinkTranslations,
} from './translationsMode';

describe('translationsAreGrouped', () => {
  it('is true for a site that keeps a document per language', () => {
    expect(
      translationsAreGrouped({ features: { translations: 'grouped' } }),
    ).toBe(true);
  });

  it('is false where a language is a version of one entity', () => {
    expect(
      translationsAreGrouped({ features: { translations: 'variants' } }),
    ).toBe(false);
  });

  it('assumes grouped when the site does not say', () => {
    // Plone's @site has no such key: it has only the grouped kind, and the
    // linking Volto ships must keep working against it.
    expect(translationsAreGrouped({ features: { multilingual: true } })).toBe(
      true,
    );
    expect(translationsAreGrouped(undefined)).toBe(true);
  });
});

describe('canLinkTranslations', () => {
  const grouped = { features: { multilingual: true, translations: 'grouped' } };
  const variants = {
    features: { multilingual: true, translations: 'variants' },
  };
  const serves = { capabilities: ['content', 'multilingual'] };

  it('offers linking when the site is grouped and the adapter serves it', () => {
    expect(
      canLinkTranslations({
        siteData: grouped,
        adapterInfo: serves,
        bridged: true,
      }),
    ).toBe(true);
  });

  it('withholds it on a grouped site whose adapter cannot serve the calls', () => {
    // The case that needed both checks: a Drupal set up the grouped way reports
    // that linking is meaningful, and the adapter still has no implementation —
    // so the control would render and fail on click.
    expect(
      canLinkTranslations({
        siteData: grouped,
        adapterInfo: { capabilities: ['content'] },
        bridged: true,
      }),
    ).toBe(false);
  });

  it('withholds it where linking has no meaning, however capable the adapter', () => {
    expect(
      canLinkTranslations({
        siteData: variants,
        adapterInfo: serves,
        bridged: true,
      }),
    ).toBe(false);
  });

  it('offers it against a CMS the admin talks to directly', () => {
    expect(
      canLinkTranslations({
        siteData: grouped,
        adapterInfo: null,
        bridged: false,
      }),
    ).toBe(true);
  });

  it('withholds it until the adapter has announced itself', () => {
    expect(
      canLinkTranslations({
        siteData: grouped,
        adapterInfo: null,
        bridged: true,
      }),
    ).toBe(false);
  });
});

describe('canTranslate', () => {
  const serves = { capabilities: ['content', 'multilingual'] };
  const multilingual = { features: { multilingual: true } };

  it('offers translating on a multilingual site the adapter can serve', () => {
    expect(
      canTranslate({ siteData: multilingual, adapterInfo: serves, bridged: true }),
    ).toBe(true);
  });

  it('offers nothing on a single-language site', () => {
    expect(
      canTranslate({
        siteData: { features: { multilingual: false } },
        adapterInfo: serves,
        bridged: true,
      }),
    ).toBe(false);
  });

  it('withholds the whole menu when the adapter serves no translations', () => {
    // A Drupal with two languages reports multilingual: true, because it is.
    // Its adapter implements none of the translation intents, so Manage
    // Translations would open onto a table whose every call rejects.
    expect(
      canTranslate({
        siteData: { features: { multilingual: true, translations: 'variants' } },
        adapterInfo: { capabilities: ['content'] },
        bridged: true,
      }),
    ).toBe(false);
  });

  it('is what linking builds on: no translating, no linking', () => {
    const args = {
      siteData: { features: { multilingual: false, translations: 'grouped' } },
      adapterInfo: serves,
      bridged: true,
    };
    expect(canTranslate(args)).toBe(false);
    expect(canLinkTranslations(args)).toBe(false);
  });
});
