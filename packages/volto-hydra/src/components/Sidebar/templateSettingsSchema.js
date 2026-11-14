/**
 * Schema for the "Template Settings" form (template name / save location) shown for a
 * top-level template instance in the sidebar. Entering edit mode is no longer a field here —
 * it's a prominent button at the top of the parent-blocks panel (see getTemplateEditButtonState).
 *
 * A template's name/location IS the template's own metadata, so changing it is editing the
 * template — only allowed while that template is being edited. When locked, the sidebar renders
 * this schema through ReadOnlyForm (static text) instead of the editable form.
 *
 * `id` is the template's URL id / filename (the last path segment). An object_browser can only
 * SELECT existing content, so the id needs a plain text field. It's only editable for a not-yet-
 * saved template (`idEditable`); renaming a saved one is a move (out of scope). Blank → derived
 * from the Template Name at save.
 *
 * @param {Object} intl
 * @param {Object} [opts]
 * @param {boolean} [opts.idEditable=true] - allow editing the Short name (new templates only)
 * @param {string} [opts.templateType] - the template's content type. A save location is any
 *   folderish item the site lets the user add that type to (its @types), not a type by name.
 */
export const getTemplateInstanceSchema = (intl, { idEditable = true, templateType } = {}) => ({
  title: 'Template Settings',
  fieldsets: [
    {
      id: 'default',
      title: 'Default',
      fields: ['title', 'id', 'folder'],
    },
  ],
  properties: {
    title: {
      title: 'Template Name',
      description: 'Display name for this template',
      type: 'string',
    },
    id: {
      title: 'Short name',
      description: 'The last part of the template’s URL. Leave blank to derive it from the name.',
      type: 'string',
      isDisabled: !idEditable,
    },
    folder: {
      title: 'Save Location',
      description: 'Folder where this template will be saved',
      widget: 'object_browser',
      mode: 'link',
      onlyFolderishSelectable: true,
      addableType: templateType,
      allowExternals: false,
    },
  },
  required: ['title'],
});

/**
 * State for the "Edit template" toggle button (the prominent, obvious replacement for the
 * old editTemplate checkbox). Kept as a pure function so its permission gating is unit-
 * testable without the React tree.
 *
 * `canEdit` gates it: a template maps to a Plone document, and entering edit mode edits that
 * document, so it requires "Modify portal content" (the doc's `can_edit`). When the user
 * lacks it, the button is disabled with a permission tooltip rather than hidden, so the
 * capability stays discoverable. `isEditing` flips the label between enter/exit.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.canEdit=true]
 * @param {boolean} [opts.isEditing=false]
 * @returns {{ label: string, disabled: boolean, title: string }}
 */
export const getTemplateEditButtonState = ({ canEdit = true, isEditing = false } = {}) => ({
  label: isEditing ? 'Done editing template' : 'Edit template',
  disabled: !canEdit,
  title: canEdit
    ? isEditing
      ? 'Exit template edit mode'
      : 'Edit this template’s structure — fixed blocks become editable'
    : 'You don’t have permission to modify this template (requires “Modify portal content”).',
});

/**
 * A template block's "kind" is the single user-facing choice that replaces the raw
 * fixed + readOnly checkboxes. The four kinds are the (fixed, readOnly) combinations:
 *   fixed-readonly   — locked chrome (logo/branding): can't move, can't edit
 *   movable-readonly — repositionable but not editable
 *   fixed-editable   — a required section: can't move, but content-editable
 *   slot             — a per-page user region (movable + editable)
 */
export const BLOCK_KINDS = [
  { id: 'fixed-readonly', title: 'Fixed, read-only', fixed: true, readOnly: true },
  { id: 'movable-readonly', title: 'Movable, read-only', fixed: false, readOnly: true },
  { id: 'fixed-editable', title: 'Fixed, editable', fixed: true, readOnly: false },
  { id: 'slot', title: 'Slot (user content)', fixed: false, readOnly: false },
];

/** Map a block's (fixed, readOnly) flags to its kind id. Defaults to 'slot'. */
export function blockKindFromFlags(fixed, readOnly) {
  return (
    BLOCK_KINDS.find((k) => k.fixed === !!fixed && k.readOnly === !!readOnly)?.id || 'slot'
  );
}

/** Map a kind id back to its (fixed, readOnly) flags. */
export function blockKindFlags(kind) {
  const k = BLOCK_KINDS.find((x) => x.id === kind);
  return { fixed: k?.fixed ?? false, readOnly: k?.readOnly ?? false };
}

/**
 * The kind choices to offer. Inside a slot the ONLY valid kind is `slot`
 * (fixed-XOR-inside-slot) — a per-page region can't contain fixed/locked template content.
 */
export function blockKindChoices(insideSlot) {
  const kinds = insideSlot ? BLOCK_KINDS.filter((k) => k.id === 'slot') : BLOCK_KINDS;
  return kinds.map((k) => [k.id, k.title]);
}

/**
 * Schema for a template block's settings — a `slotId` plus a single `kind` dropdown that
 * replaces the fixed + readOnly checkboxes. When the block is inside a slot, `kind` offers
 * only `slot`, enforcing fixed-XOR-inside-slot in the UI (the save normalizer backs this up).
 */
export const getTemplateBlockSettingsSchema = ({ insideSlot = false } = {}) => ({
  title: 'Template Block Settings',
  fieldsets: [
    { id: 'default', title: 'Default', fields: [] },
    { id: 'template', title: 'Template Settings', fields: ['slotId', 'kind'] },
  ],
  properties: {
    slotId: {
      title: 'Slot ID',
      description:
        'Identifies where user content goes in the template (e.g., "header", "primary")',
      type: 'string',
    },
    kind: {
      title: 'Block kind',
      description: insideSlot
        ? 'This block is inside a slot, so it can only be user content (a slot).'
        : 'How this block behaves in the template.',
      choices: blockKindChoices(insideSlot),
    },
  },
  required: ['slotId'],
});
