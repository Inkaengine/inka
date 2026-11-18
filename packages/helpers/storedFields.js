/**
 * What a stored block may hold beyond the fields its schema declares, and which
 * of its fields are undeclared. One answer for the content check (a stored
 * undeclared field is an error) and the editor's save (it strips them: a
 * conversion keeps a block's other fields while editing, so switching the type
 * back restores them, and the save drops what the final type doesn't declare).
 */

// Fields present in block data that are not schema properties but are never
// authored/editable content: structural, serialisation, and Volto slot runtime.
// The template trio (templateId/templateInstanceId/slotId) is written by the
// template machinery to bind a block to its template instance and slot; it is
// not sidebar-editable, so it must not be reported as an undeclared field.
// A block's template membership, stored on the block beside its own fields.
// The merge reads these keys, so no block schema may name a field after one
// (checkReservedFields).
export const TEMPLATE_MEMBERSHIP_KEYS = [
  'fixed', 'slotId', 'templateId', 'templateInstanceId', 'readOnly',
  // Written by the merge beside slotId when a fixed slot separates two groups
  // (apply-templates stamps it); hydra's bookkeeping, never sidebar-authored.
  // `prevSlotId` mirrors it for a slot region BEFORE a fixed block
  // (blockSync.js), and was missing here — so real content carrying it was
  // reported as an undeclared field.
  'nextSlotId', 'prevSlotId',
];

// Inka's own bookkeeping, also stored on the block: the words it indexes
// (searchableText.js writes it on save), Volto's older copy of a Text block's
// words that plone.restapi reads (plaintext: save removes it), copy-from-target's record (_pullFrom, and _customFields
// before it), the anchors the bridge harvests, and the block's identity
// (`@type`, `@uid`, any `@` key). A field of one of these names would be
// overwritten by Inka, or read by it as something it is not.
export const BLOCK_BOOKKEEPING_KEYS = ['searchableText', 'plaintext', '_pullFrom', '_customFields', '_linkableAnchors'];

export const UNDECLARED_EXEMPT = new Set([
  'blocks', 'blocks_layout', 'image_scales', 'searchableText', 'value',
  'styles', 'override', 'block',
  ...TEMPLATE_MEMBERSHIP_KEYS,
  // codeExample selector directives (single-source example pages): `source`
  // names a block/@type on the page and `format` (json|schema) says what to
  // show; resolved to `tabs` at load/build, not sidebar-authored schema fields.
  'source', 'format',
  // Deep-link anchors hydra harvests + persists on the owning block (#273/#281).
  // Not sidebar-authored — a consumer (in-page nav) reads them; exempt like the
  // other serialisation/runtime fields above.
  '_linkableAnchors',
  // hydra's own bookkeeping for copy-from-target (PULL_FROM_KEY in
  // utils/copyFromTargetMapping.js): which of the block's fields each link owns,
  // so a pull never touches anything else. Declaring it as a schema property
  // would offer the bookkeeping itself as an editable field.
  '_pullFrom',
  // Its predecessor, which recorded the inverse (the fields an author had
  // overridden, with absence meaning "pulled"). Still exempt so content written
  // before inka#595 validates: the key is ignored at runtime, not an error.
  '_customFields',
  // collective.volto.formsupport regenerates `validationSettings` on every GET
  // of a form block — it is the catalogue of settable validators the sidebar
  // builds its "Rule settings" widget FROM, so it is a property of the response,
  // not of what is stored. The undeclared-field check asks "is a stored field
  // missing from the schema", and for this one the premise does not hold:
  // declaring it would offer the catalogue itself as an editable field.
  'validationSettings',
  // Which field of the referenced content holds the image. Written by the
  // serialiser alongside `image_scales` (already exempt above), not authored.
  'image_field',
  // volto-form-block stamps this to invalidate its cached render. A timestamp
  // (e.g. 1710238630312) is not something an author writes in the sidebar.
  'lastChange',
  // Marks a template member as one the template requires, alongside
  // fixed/slotId/templateId. Not a field: declaring it as one filled the
  // sidebar for a metadata block that has no fields of its own, hiding the
  // content item's fields it exists to project.
  'required',
]);


/**
 * The fields of a stored block its schema doesn't declare.
 *
 * @param {Object} block - the stored block (or list item)
 * @param {Object} declared
 * @param {string[]} declared.fields - the fields its schema declares, and those its rules may add
 * @param {string[]} [declared.identityFields] - the key and type field of the list it is an item of
 * @param {string|null} [declared.defaultsPrefix] - a container's per-item defaults prefix
 * @returns {string[]} the undeclared fields; `@` keys are not among them (they are
 *   identity, or stray in a way checkReservedFields reports)
 */
export function undeclaredFieldsOf(block, { fields, identityFields = [], defaultsPrefix = null }) {
  return Object.keys(block).filter((field) => !field.startsWith('@')
    && !UNDECLARED_EXEMPT.has(field)
    && !identityFields.includes(field)
    && !(defaultsPrefix && field.startsWith(defaultsPrefix))
    && !fields.includes(field));
}
