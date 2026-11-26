/**
 * Which result fields can be mapped onto which block fields, and with which
 * conversion (a `convertFieldValue` targetType).
 *
 * One rule, read by the mapping widget (the targets it offers a source, and the
 * conversion it stores), the editor's load check of a config's mappings, and
 * the content check of a listing's stored mapping. A mapping it refuses would
 * make items the editor can't hold: a list in a text field, an image object in
 * a title, a date wrapped as a link.
 *
 * Pure, with no imports beyond its own package.
 */
import { ADDRESS_SOURCE } from './catalogAddress.js';

/** A source's declared `type` (sourceFields, the catalog) → the kind of value it gives. */
const KIND_OF_SOURCE_TYPE = {
  string: 'text',
  image: 'image',
  date: 'date',
  array: 'list',
  boolean: 'boolean',
};

/** The source `type`s a mapping widget may declare. */
export const SOURCE_TYPES = Object.keys(KIND_OF_SOURCE_TYPE);

/** The source `type` that gives values of a kind: a column's, once columnKind knows it. */
export function sourceTypeOfKind(kind) {
  const type = SOURCE_TYPES.find((name) => KIND_OF_SOURCE_TYPE[name] === kind);
  if (!type) throw new Error(`No source type gives a ${kind}.`);
  return type;
}

/** The catalog fields a linked page or listing result gives, by kind. */
export const CATALOG_SOURCE_KINDS = {
  [ADDRESS_SOURCE]: 'address',
  title: 'text',
  description: 'text',
  image: 'image',
  hasPreviewImage: 'boolean',
  Subject: 'list',
  created: 'date',
  modified: 'date',
  effective: 'date',
  expires: 'date',
  start: 'date',
  end: 'date',
};

/**
 * The kind of value a source gives. The address is its own kind (it can become
 * a link); otherwise its declared `type` says. A type with no conversion throws.
 */
export function sourceKind(source, sourceDef) {
  if (source === ADDRESS_SOURCE) return 'address';
  const kind = KIND_OF_SOURCE_TYPE[sourceDef?.type];
  if (!kind) {
    throw new Error(
      `Mapping source "${source}" has type ${JSON.stringify(sourceDef?.type)}, which Inka has no ` +
        `conversion for (${Object.keys(KIND_OF_SOURCE_TYPE).join(', ')}).`,
    );
  }
  return kind;
}

/**
 * The kind of value a content type's field gives, from its schema as Plone's
 * `@types/<type>` serves it; null when Inka has no conversion for it (rich
 * text, a number, an image, a list of anything but strings).
 */
export function kindOfContentField(def) {
  if (def.widget === 'date' || def.widget === 'datetime') return 'date';
  if (def.type === 'array') return def.items?.type === 'string' ? 'list' : null;
  if (def.type === 'boolean') return 'boolean';
  if (def.type === 'string' && def.widget !== 'richtext') return 'text';
  return null;
}

/**
 * The kind of value a site's own catalog column gives (one a mapping offers
 * through a vocabulary, as `plone.app.vocabularies.MetadataFields` names them).
 *
 * A column has no type of its own: the catalog fills it from the object
 * attribute of the same, exact name. So the field of that name says: on the
 * edited page's type first; else on the site's other types, since a column can
 * be filled by a few types only (an event's `start`). Types that hold it
 * differently are refused rather than guessed between; a column no type has a
 * field for is filled by an indexer, and is text.
 *
 * @param {string} column
 * @param {Object} site
 * @param {Object} site.contentTypes - type name → its `@types/<type>` schema
 * @param {string} site.pageType - the edited page's type
 * @returns {{ kind: string|null, problem?: string }}
 */
export function columnKind(column, site) {
  if (!site?.contentTypes) {
    throw new Error(`The kind of column "${column}" comes from the site's content types, and none were given.`);
  }
  const { contentTypes, pageType } = site;
  const fieldIn = (type) => contentTypes[type]?.properties?.[column];
  const typed = (type) => {
    const kind = kindOfContentField(fieldIn(type));
    return kind
      ? { kind }
      : { kind: null, problem: `"${column}" is a field of ${type} whose value Inka has no conversion for.` };
  };
  if (fieldIn(pageType)) return typed(pageType);
  const holders = Object.keys(contentTypes).filter(fieldIn);
  if (holders.length === 0) return { kind: 'text' };
  const kinds = new Map(holders.map((type) => [type, kindOfContentField(fieldIn(type))]));
  if (new Set(kinds.values()).size > 1) {
    const each = [...kinds].map(([type, kind]) => `${type} a ${kind ?? 'value Inka has no conversion for'}`).join(', ');
    return { kind: null, problem: `"${column}" holds different things on different types (${each}), so there is no telling what a result gives.` };
  }
  return typed(holders[0]);
}

/**
 * What a block field holds, as a mapping target, or null when nothing can be
 * mapped onto it: a choice (a result's value need not be one of its tokens), a
 * region, an object, a number.
 */
export function targetKind(wrapped) {
  // Copy-from-target wraps a linked field, keeping the field itself here.
  const def = wrapped?.widget === 'copyFromTargetField' ? wrapped.baseWidget : wrapped;
  if (!def || def.choices || def.items?.choices || def.vocabulary) return null;
  if (def.widget === 'blocks_layout' || def.widget === 'object_list') return null;
  if (def.widget === 'object_browser') return def.mode === 'image' ? 'image_link' : 'link';
  if (def.widget === 'url') return 'link';
  if (def.widget === 'image') return 'image';
  if (def.widget === 'slate' || def.type === 'slate') return 'slate';
  if (def.widget === 'textarea') return 'textarea';
  if (def.widget === 'date' || def.widget === 'datetime') return 'date';
  // Volto's free list widgets: a list of strings (one with choices is out above).
  if (def.widget === 'array' || def.widget === 'token') return 'list';
  if (def.widget) return null; // a widget this rule doesn't know: nothing offered
  if (def.type === 'boolean') return 'boolean';
  if (def.type === 'array') return 'list';
  if (def.type === 'string' || def.type === undefined) return 'string';
  return null;
}

/**
 * The conversion (a `convertFieldValue` targetType) a field's widget calls for,
 * or null when its value needs none. The one derivation: converting a block,
 * pulling from a linked page and storing a listing's mapping all use it.
 *
 * A `url` field holds the object-browser link list, `[{ '@id': url }]`, as the
 * editor's url widget writes it, so it takes `link`, like `object_browser`.
 *
 * @param {string} widget - The widget name from the schema field
 * @param {Object} fieldDef - The full field definition (to check mode, etc.)
 */
export function widgetToTargetType(widget, fieldDef) {
  if (widget === 'object_browser') {
    // object_browser in image mode: array format [{ '@id': url, image_field?, image_scales? }]
    if (fieldDef?.mode === 'image') return 'image_link';
    return 'link';
  }
  // ImageWidget: string value + sibling image_field/image_scales fields on the block
  if (widget === 'image') return 'image';
  if (widget === 'url') return 'link';
  if (widget === 'slate') return 'slate';
  if (widget === 'textarea') return 'textarea';
  return null;
}

const unwrap = (def) => (def?.widget === 'copyFromTargetField' ? def.baseWidget : def);

/**
 * kind → target kind → the conversions that give a value the field holds.
 * Every one is named: a listing stores its mapping, and its renderer, which
 * has no schema, converts by what is stored, so no entry may leave it out. An
 * image is always `image_link`: `image` reduces a result's image object to its
 * `@id` (the page's address), and `link` drops its scales.
 */
const ACCEPTED = {
  address: { link: ['link'], string: ['string'], textarea: ['textarea'], slate: ['slate'] },
  text: { string: ['string'], textarea: ['textarea'], slate: ['slate'] },
  image: { image_link: ['image_link'], image: ['image_link'], link: ['image_link'] },
  date: { date: ['string'], string: ['string'], textarea: ['textarea'] },
  list: { list: ['array'], string: ['string'], textarea: ['textarea'], slate: ['slate'] },
  boolean: { boolean: ['boolean'] },
};

/** Whether a source of `kind`, converted as `conversion`, gives what `def` holds. */
export function isAccepted(kind, def, conversion) {
  const target = targetKind(def);
  return Boolean(conversion && target && ACCEPTED[kind]?.[target]?.includes(conversion));
}

/**
 * The conversion to record for a source of `kind` mapped onto `def`: the one
 * its widget calls for, when that gives what the field holds; else the one the
 * source needs (a list into text is joined: `string`). undefined: nothing makes
 * it fit, so it isn't offered.
 */
export function conversionFor(kind, def) {
  const field = unwrap(def);
  const derived = widgetToTargetType(field?.widget, field);
  if (isAccepted(kind, def, derived)) return derived;
  return ACCEPTED[kind]?.[targetKind(def)]?.[0];
}
