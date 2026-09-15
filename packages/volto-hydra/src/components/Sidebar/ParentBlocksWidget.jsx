/**
 * ParentBlocksWidget - Renders parent block settings in the sidebar.
 * Shows the chain of parent containers from root to the current block.
 *
 * The ‹ arrow always navigates UP one level (selects parent, closes current).
 *
 * Example hierarchy for text-1a inside col-1 inside columns-1:
 *   ‹ Columns     [...]   ← Click ‹ to deselect (go to page)
 *     [columns settings]
 *   ‹ Column      [...]   ← Click ‹ to select columns-1
 *     [column settings]
 *   ‹ Text        [...]   ← Click ‹ to select col-1 (current block, highlighted)
 *
 * Uses SidebarPortalTargetContext to redirect each block's Edit component's
 * SidebarPortal content to unique target elements for each block in the hierarchy.
 */

import React from 'react';
import PropTypes from 'prop-types';
import { createPortal } from 'react-dom';
import {
  getTemplateInstanceSchema,
  getTemplateBlockSettingsSchema,
  blockKindFromFlags,
  blockKindFlags,
} from './templateSettingsSchema';
import { useIntl } from 'react-intl';
import { useLocation } from 'react-router-dom';
import { set, cloneDeep, isEqual } from 'lodash';
import config from '@plone/volto/registry';
import { BlockDataForm } from '@plone/volto/components/manage/Form';
import { Icon } from '@plone/volto/components';
import leftArrowSVG from '@plone/volto/icons/left-key.svg';
import TemplateLockToggle from '../Toolbar/TemplateLockToggle';
import { SidebarPortalTargetContext } from './SidebarPortalTargetContext';
import DropdownMenu from '../Toolbar/DropdownMenu';
import ReadOnlyForm from './ReadOnlyForm';
import { getBlockById, updateBlockById, getResolvedSchema, getCommonAncestor } from '../../utils/blockPath';
import { HydraSchemaProvider } from '../../context';
import { getConvertibleTypes, convertBlockType, findTypeField } from '../../utils/blockSync';
import { PAGE_BLOCK_UID } from '@volto-hydra/hydra-js';
import { isBlockReadonly } from '@volto-hydra/helpers';
import { flattenToAppURL } from '@plone/volto/helpers';

/**
 * Get the display title for a block type
 * For object_list items, looks up the itemSchema.title from the parent's field definition
 */
const getBlockTypeTitle = (blockType, blockPathMap, blockId) => {
  // Check if this is an object_list item via blockPathMap FIRST
  // (object_list items often don't have @type, so blockType may be undefined)
  const pathInfo = blockPathMap?.[blockId];
  if (pathInfo?.isObjectListItem) {
    // Look up title from blocksConfig — works for both typed items (e.g., 'text')
    // and virtual types (e.g., 'slateTable:rows')
    if (pathInfo.blockType) {
      const itemConfig = config.blocks?.blocksConfig?.[pathInfo.blockType];
      if (itemConfig?.title) return itemConfig.title;
    }

    // Fallback: derive from the region/field name (e.g., "subblocks" -> "Subblock")
    if (pathInfo.region) {
      const singular = pathInfo.region.replace(/s$/, '');
      return singular.charAt(0).toUpperCase() + singular.slice(1);
    }
  }

  if (!blockType) return 'Block';

  const blockConfig = config.blocks?.blocksConfig?.[blockType];
  return blockConfig?.title || blockType;
};

/**
 * Get parent chain for a block from blockPathMap
 * Returns array of parent block IDs from root to immediate parent
 */
const getParentChain = (blockId, blockPathMap) => {
  if (!blockId || !blockPathMap) return [];

  const parents = [];
  let currentId = blockId;

  while (currentId) {
    const pathInfo = blockPathMap[currentId];
    // Stop at PAGE_BLOCK_UID - it's the root, not a block to show in hierarchy
    if (pathInfo?.parentId && pathInfo.parentId !== PAGE_BLOCK_UID) {
      parents.unshift(pathInfo.parentId); // Add to front
      currentId = pathInfo.parentId;
    } else {
      break;
    }
  }

  return parents;
};


/**
 * Filter out container fields from schema (widget: 'blocksid_list' or widget: 'object_list')
 * These fields display as [object Object] and should be managed via the block hierarchy instead
 */
const filterBlocksFields = (schema) => {
  if (!schema) return null;

  const containerFields = new Set();
  for (const [fieldId, fieldDef] of Object.entries(schema.properties || {})) {
    if (fieldDef?.widget === 'blocksid_list' || fieldDef?.widget === 'object_list') {
      containerFields.add(fieldId);
    }
  }

  // If no container fields, return schema as-is
  if (containerFields.size === 0) return schema;

  // Filter out container fields from fieldsets and properties
  return {
    ...schema,
    fieldsets: schema.fieldsets?.map((fieldset) => ({
      ...fieldset,
      fields: fieldset.fields?.filter((f) => !containerFields.has(f)),
    })),
    properties: Object.fromEntries(
      Object.entries(schema.properties || {}).filter(
        ([key]) => !containerFields.has(key),
      ),
    ),
  };
};

/**
 * Get the block schema for a block type, filtered for sidebar display.
 * Returns filtered schema (without blocks-type fields) or null.
 * For object_list items, uses the cached itemSchema from blockPathMap.
 */
const getFilteredBlockSchema = (blockType, intl, blockPathMap, blockId, blockData) => {
  const pathInfo = blockPathMap?.[blockId];

  // For object_list items (like table rows/cells), use itemSchema from blockPathMap
  if (pathInfo?.isObjectListItem && pathInfo.itemSchema?.fieldsets) {
    return filterBlocksFields({
      ...pathInfo.itemSchema,
      required: pathInfo.itemSchema.required || [],
    });
  }

  // Use cached enhanced schema from pathMap (built during buildBlockPathMap)
  const schema = getResolvedSchema(pathInfo, blockPathMap);
  if (!schema) {
    console.error(`[getFilteredBlockSchema] No cached resolvedBlockSchema for '${blockId}' (type: ${blockType})`);
    return null;
  }

  // Filter out blocks-type fields (container fields) for sidebar display
  return filterBlocksFields(schema);
};

// getTemplateBlockSettingsSchema (a single `kind` dropdown replacing the fixed + readOnly
// checkboxes, with the inside-slot restriction) lives in the pure ./templateSettingsSchema
// module so it can be unit-tested without the React tree. Imported at the top of this file.

/**
 * Single parent block section with header and settings
 * Renders the block's Edit component with SidebarPortal redirected to this section
 */
/**
 * Schema for template instance settings
 * Used by BlockDataForm to render a consistent form
 */
// getTemplateInstanceSchema (with editTemplate permission gating) lives in the pure,
// dependency-free ./templateSettingsSchema module so it can be unit-tested without the
// React/Volto component tree. Imported at the top of this file.

const ParentBlockSection = ({
  blocksErrors = {},
  blockId,
  blockType,
  blockData,
  parentId,
  index,
  isCurrentBlock,
  onSelectBlock,
  onDeleteBlock,
  onChangeBlock,
  onBlockAction,
  formData,
  pathname,
  intl,
  blockPathMap,
  liveBlockDataRef,
  templateEditMode,
  onChangeTemplateSettings,
  onToggleTemplateEditMode,
  templatePermissions,
}) => {
  // Get intl from context if not passed (needed for getTemplateInstanceSchema)
  const contextIntl = useIntl();
  // Store current block data in liveBlockDataRef on every render
  // This ensures child schemaEnhancers can see parent's current data
  if (liveBlockDataRef && blockData) {
    liveBlockDataRef.current[blockId] = blockData;
  }

  // Get pathInfo for template instance detection
  const pathInfo = blockPathMap?.[blockId];

  // This section IS a top-level template instance → it carries the lock/unlock
  // toggle (on this "blind" header bar) + the "Edit template" dropdown item, which
  // replace the old standalone Edit-template button. Locked (🔒) = not editing;
  // unlocked (🔓) = editing this template. Permission-gated on the template doc.
  const isThisTemplateInstance =
    !!pathInfo?.isTemplateInstance && !pathInfo?.isNestedTemplateInstance;
  // v2: templateEditMode is the set of unlocked instance ids. The instance's
  // block id IS its templateInstanceId (see the toggle handler in View.jsx).
  const isEditingThisTemplate = (templateEditMode || []).includes(blockId);
  const canEditTemplate =
    templatePermissions?.[pathInfo?.templateId]?.can_edit ?? true;
  const canToggleTemplateEdit =
    isThisTemplateInstance && !!onToggleTemplateEditMode && canEditTemplate;
  // The handler decides unlock (warning modal) vs lock (decision modal) from the
  // instance's current membership, so we always pass the instance id.
  const toggleTemplateEdit = () => onToggleTemplateEditMode(blockId);

  const [menuOpen, setMenuOpen] = React.useState(false);
  const [menuButtonRect, setMenuButtonRect] = React.useState(null);
  const menuButtonRef = React.useRef(null);

  const title = getBlockTypeTitle(blockType, blockPathMap, blockId);
  // Use sidebar-properties for current block (backwards compat), parent-sidebar-{id} for parents
  const targetId = isCurrentBlock ? 'sidebar-properties' : `parent-sidebar-${blockId}`;

  // Get the Edit component for this block type
  // Skip Edit component if disableCustomSidebarEditForm is set (e.g., slateTable's Edit expects specific data structures)
  // For readonly blocks, use the View component instead (like Volto core does)
  // Use shared isBlockReadonly to handle template edit mode correctly
  const blockConfig = config.blocks?.blocksConfig?.[blockType];
  const useSchemaOnly = blockConfig?.disableCustomSidebarEditForm;
  const isReadonly = isBlockReadonly(blockData, templateEditMode);
  // Read-only blocks render through ReadOnlyForm (below), never an editable Edit
  // component (nor a hidden View, which produced no sidebar form and left view-less
  // read-only blocks with an empty panel). So a read-only block always shows its
  // values as static text, and never an editable input.
  const BlockEdit = useSchemaOnly || isReadonly ? null : blockConfig?.edit;

  // Get schema for fallback rendering (when no Edit component or disableCustomSidebarEditForm)
  const schema = !BlockEdit ? getFilteredBlockSchema(blockType, intl, blockPathMap, blockId, blockData) : null;

  // Compute a key suffix that changes when parent's block sync state changes.
  // This forces BlockEdit to remount when parent's typeField changes, ensuring child gets fresh schema.
  // Without this, Volto's BlockEdit caches its internal form and doesn't re-render with new schema.
  const parentSchemaKey = React.useMemo(() => {
    if (!parentId || !liveBlockDataRef?.current) return '';
    const parentBlock = liveBlockDataRef.current[parentId];
    if (!parentBlock) return '';
    const parentConfig = config.blocks?.blocksConfig?.[parentBlock['@type']];
    const parentTypeField = findTypeField(parentConfig, contextIntl);
    if (!parentTypeField) return '';
    return `-parent-${parentTypeField}:${parentBlock[parentTypeField] || 'none'}`;
  }, [parentId, liveBlockDataRef?.current?.[parentId], contextIntl]);

  const handleMenuClick = (e) => {
    e.stopPropagation();
    if (menuButtonRef.current) {
      setMenuButtonRect(menuButtonRef.current.getBoundingClientRect());
    }
    setMenuOpen(!menuOpen);
  };

  return (
    <div className="sidebar-section parent-block-section">
      <div
        className="sidebar-section-header sticky-header"
        data-is-current={isCurrentBlock}
      >
        <div className="parent-nav">
          {blockId !== PAGE_BLOCK_UID && (
            <button
              className="nav-back"
              onClick={() => onSelectBlock(parentId || null)}
              title={parentId ? 'Go to parent' : 'Deselect block'}
            >
              <Icon name={leftArrowSVG} size="24px" />
            </button>
          )}
          <button
            className="nav-title"
            onClick={() => onSelectBlock(blockId)}
            title={`Select ${title}`}
          >
            {title}
          </button>
        </div>
        <div className="block-actions-menu" style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          {/* Toolbar action buttons (e.g., add row/column for tables) */}
          {(() => {
            const pathInfo = blockPathMap?.[blockId];
            const toolbarActions = pathInfo?.actions?.toolbar || [];
            if (toolbarActions.length === 0 || !onBlockAction) return null;
            const actionsRegistry = config.settings.hydraActions || {};
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: '1px' }}>
                {toolbarActions.map((actionId) => {
                  const actionDef = actionsRegistry[actionId] || { label: actionId };
                  return (
                    <button
                      key={actionId}
                      title={actionDef.label}
                      onClick={() => onBlockAction(actionId, blockId)}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: '4px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '2px',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#e8e8e8')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                    >
                      {actionDef.icon ? (
                        <Icon name={actionDef.icon} size="18px" />
                      ) : (
                        actionDef.label
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })()}
          {/* The ONE shared template lock/unlock control (same component the quanta
              toolbar renders) — a whole-template action shown on the instance's row. */}
          {isThisTemplateInstance && onToggleTemplateEditMode && (
            <TemplateLockToggle
              instanceId={blockId}
              editing={isEditingThisTemplate}
              canEdit={canEditTemplate}
              onToggle={onToggleTemplateEditMode}
              variant="sidebar"
            />
          )}
          <button
            ref={menuButtonRef}
            className="menu-trigger"
            title="Block actions"
            onClick={handleMenuClick}
          >
            •••
          </button>
          {menuOpen && (() => {
            const pathInfo = blockPathMap?.[blockId];
            const blocksConfig = config.blocks?.blocksConfig;
            const convertibleTypes = getConvertibleTypes(blockType, blocksConfig, pathInfo?.allowedSiblingTypes);
            const handleConvertBlock = (newType) => {
              const newBlockData = convertBlockType(blockData, newType, blocksConfig, '@type', intl);
              // Preserve the block ID
              newBlockData['@uid'] = blockId;
              onChangeBlock(blockId, newBlockData);
            };
            return (
              <DropdownMenu
                selectedBlock={blockId}
                onDeleteBlock={onDeleteBlock}
                menuButtonRect={menuButtonRect}
                onClose={() => setMenuOpen(false)}
                // No onOpenSettings - we're already in sidebar/settings
                parentId={parentId}
                onSelectBlock={onSelectBlock}
                tableActions={pathInfo?.actions}
                onTableAction={onBlockAction ? (actionId) => onBlockAction(actionId, blockId) : null}
                addMode={pathInfo?.addMode}
                parentAddMode={pathInfo?.parentAddMode}
                addDirection={pathInfo?.addDirection}
                convertibleTypes={convertibleTypes}
                onConvertBlock={handleConvertBlock}
                // Same rule as the canvas toolbar: `fixed` withholds removal
                // from a PAGE, not from the template's own author. Once the
                // template a block BELONGS to is unlocked, it is removable.
                // (`isEditingThisTemplate` is about the instance itself, so it
                // is the wrong question for a member.)
                isFixed={
                  !!blockData?.fixed &&
                  !(templateEditMode || []).includes(blockData?.templateInstanceId)
                }
                isReadonly={!!blockData?.readOnly}
                isInTemplate={!!blockData?.templateId}
                onMakeTemplate={onBlockAction ? () => onBlockAction('makeTemplate', blockId) : null}
                isTemplateInstance={isThisTemplateInstance}
                isEditingTemplate={isEditingThisTemplate}
                onToggleTemplateEdit={canToggleTemplateEdit ? toggleTemplateEdit : null}
              />
            );
          })()}
        </div>
      </div>

      {/* Portal target for parent blocks only - they render their own sidebar content
          Current block's #sidebar-properties is a static element in Sidebar.jsx */}
      {!isCurrentBlock && (
        <div
          id={targetId}
          className="sidebar-section-content parent-block-settings"
        />
      )}

      {/* Render Edit component for sidebar content
          We take full control - SidebarPortal only renders when context is set
          Parent blocks: render to their own target div
          Current block: render to sidebar-properties */}
      {BlockEdit && (
        <HydraSchemaProvider value={{ blockPathMap, currentBlockId: blockId, formData, blocksConfig: config.blocks?.blocksConfig, liveBlockDataRef, onChangeBlock }}>
          <SidebarPortalTargetContext.Provider value={targetId}>
            {/* Hidden container - Edit component's center content is hidden, only sidebar renders */}
            {/* Key includes parentSchemaKey to force remount when parent's block sync changes */}
            <div key={`${blockId}${parentSchemaKey}`} style={{ display: 'none' }}>
              <BlockEdit
                type={blockType}
                id={blockId}
                data={blockData}
                selected={true}
                index={index}
                properties={formData}
                pathname={pathname}
                intl={intl}
                manage={true}
                onChangeBlock={onChangeBlock}
                onChangeField={() => {}}
                // For parent blocks, use no-op to prevent Edit components from changing
                // selection when they initialize/render. This was causing parent blocks
                // to get selected when clicking on child blocks (e.g., empty blocks).
                // For current block, use real onSelectBlock for sub-selections.
                onSelectBlock={isCurrentBlock ? onSelectBlock : () => {}}
                // These are needed but not used for sidebar-only rendering
                onMoveBlock={() => {}}
                onDeleteBlock={() => {}}
                onAddBlock={() => {}}
                onFocusPreviousBlock={() => {}}
                onFocusNextBlock={() => {}}
                handleKeyDown={() => {}}
                block={blockId}
                blocksConfig={config.blocks?.blocksConfig}
                navRoot={{}}
                contentType={formData?.['@type']}
              />
            </div>
          </SidebarPortalTargetContext.Provider>
        </HydraSchemaProvider>
      )}

      {/* Fallback: If no Edit component but has schema, render BlockDataForm directly.
          NOT for a read-only block: that one renders its values as static text
          through ReadOnlyForm below, and rendering an editable form as well —
          however thoroughly disabled — means every widget has to honour
          `isDisabled` for the panel to be trustworthy. Volto's object browser
          does not: it disables its browse button but still renders a typeable
          <input> for an empty field, so a locked block had a box an author
          could type into whose value was then dropped on the way out. A form
          that isn't rendered has nothing to lock. */}
      {!BlockEdit && schema && !isReadonly && !pathInfo?.isTemplateInstance && (() => {
        const formSchema = schema;
        // Field rules that SAY something rather than refuse it. A warning is
        // deliberately not a validator — it must not block the save — so it
        // has no route through Volto's error machinery and is rendered here,
        // from the resolved schema, beside the fields it is about.
        const warnings = Object.entries(formSchema.properties || {})
          .filter(([, def]) => def?.hydraRuleWarning)
          .map(([field, def]) => ({
            field,
            title: def.title || field,
            message: def.hydraRuleWarning,
          }));
        const formContent = (
          <HydraSchemaProvider value={{ blockPathMap, currentBlockId: blockId, formData, blocksConfig: config.blocks?.blocksConfig, liveBlockDataRef, onChangeBlock }}>
            <>
            {warnings.length > 0 && (
              <div className="hydra-field-warnings" role="status">
                {warnings.map((w) => (
                  <p key={w.field} className="hydra-field-warning">
                    <strong>{w.title}:</strong> {w.message}
                  </p>
                ))}
              </div>
            )}
            <BlockDataForm
              errors={blocksErrors?.[blockId] ? { [blockId]: blocksErrors[blockId] } : {}}
              schema={formSchema}
              onChangeField={(fieldId, value) => {
                // Belt and braces: the widgets are disabled, and a change that
                // reaches here anyway (a widget that ignores `isDisabled`) is
                // not written to a block the page may not edit.
                if (isReadonly) return;
                // Use lodash set for nested paths like 'itemDefaults.overwrite'
                const newBlockData = cloneDeep(blockData);
                set(newBlockData, fieldId, value);
                onChangeBlock(blockId, newBlockData);
              }}
              onChangeBlock={(id, data) => {
                onChangeBlock(id, data);
              }}
              formData={blockData}
              block={blockId}
              applySchemaEnhancers={true}
            />
            </>
          </HydraSchemaProvider>
        );
        // Portal to the target element (sidebar-properties for current, parent-sidebar-{id} for parents)
        const targetElement = document.getElementById(targetId);
        return targetElement ? createPortal(formContent, targetElement) : null;
      })()}

      {/* Read-only block (fixed/readonly template chrome, or a readonly block in
          normal mode): render its schema fields as static text, never editable. */}
      {schema && isReadonly && !pathInfo?.isTemplateInstance && (() => {
        const targetElement = document.getElementById(targetId);
        return targetElement
          ? createPortal(
              <ReadOnlyForm schema={schema} formData={blockData} />,
              targetElement,
            )
          : null;
      })()}

      {/* Template instance settings form — only for top-level, not nested */}
      {pathInfo?.isTemplateInstance && !pathInfo?.isNestedTemplateInstance && onChangeTemplateSettings && (() => {
        // Template instance settings: name / save location. These are the TEMPLATE'S
        // OWN metadata (its document title + where it lives), so read them from the
        // cached template document — NOT the instance block, which only carries them
        // right after "Make Template". The doc is fetched + cached during the merge and
        // passed here as templatePermissions; onChangeTemplateSettings writes edits back
        // into it, so it stays the live source of truth. Editable only while editing.
        const tplDoc = templatePermissions?.[pathInfo?.templateId];
        const tplDocId = tplDoc?.['@id'];
        const tplLocation =
          tplDocId && tplDocId.lastIndexOf('/') > 0
            ? flattenToAppURL(tplDocId.slice(0, tplDocId.lastIndexOf('/')))
            : undefined;
        const templateFormData = {
          title: tplDoc?.title,
          // Short name = the template's URL id (its filename). Empty for a brand-new
          // template until the author sets it (or it's derived from the name at save).
          id: tplDoc?.id,
          // A pending Save-Location edit lives on the doc's `folder`; otherwise show
          // where the template currently lives (its @id's parent folder).
          folder:
            tplDoc?.folder ||
            (tplLocation ? [{ '@id': tplLocation, title: tplLocation }] : undefined),
        };
        // The Short name is only editable for a not-yet-saved template; renaming a
        // saved template's id is a move (out of scope here).
        const templateSchema = getTemplateInstanceSchema(contextIntl, {
          idEditable: !!tplDoc?._isNew,
        });
        const formContent = isEditingThisTemplate ? (
          <HydraSchemaProvider value={{ blockPathMap, currentBlockId: blockId, formData, blocksConfig: config.blocks?.blocksConfig, liveBlockDataRef, onChangeBlock }}>
            <BlockDataForm
              schema={templateSchema}
              onChangeField={(fieldId, value) => {
                onChangeTemplateSettings(blockId, { [fieldId]: value });
              }}
              formData={templateFormData}
              block={blockId}
            />
          </HydraSchemaProvider>
        ) : (
          <ReadOnlyForm schema={templateSchema} formData={templateFormData} />
        );
        const targetElement = document.getElementById(targetId);
        return targetElement ? createPortal(formContent, targetElement) : null;
      })()}

      {/* Template block settings form - shown when editing a block inside a template during edit mode */}
      {(() => {
        // Check if this block is inside the template being edited. object_list items
        // (slides, rows) are template members too — every block in a template can set
        // fixed/readOnly, so they show this panel as well. Only the template-instance
        // host block itself is excluded (it's the container, not a member).
        const isBlockInEditedTemplate =
          !pathInfo?.isTemplateInstance &&
          blockData &&
          blockData.templateId &&
          (templateEditMode || []).includes(blockData.templateInstanceId);

        if (!isBlockInEditedTemplate) return null;

        // fixed-XOR-inside-slot: a block is "inside a slot" when any ancestor is a slot
        // (a template block that is neither fixed nor readOnly). Inside a slot the only
        // allowed kind is `slot`, so the dropdown drops the fixed-bearing options.
        const isInsideSlot = (bid) => {
          let pid = blockPathMap[bid]?.parentId;
          while (pid) {
            const anc = getBlockById(formData, blockPathMap, pid);
            if (!anc) break;
            if (anc.templateInstanceId && !anc.fixed && !anc.readOnly) return true;
            pid = blockPathMap[pid]?.parentId;
          }
          return false;
        };
        const insideSlot = isInsideSlot(blockId);
        // Build form data with current template block settings — `kind` is derived from the
        // block's fixed/readOnly flags (the single dropdown replaces the two checkboxes).
        const templateBlockFormData = {
          slotId: blockData.slotId || '',
          kind: blockKindFromFlags(blockData.fixed, blockData.readOnly),
        };
        const templateBlockSchema = getTemplateBlockSettingsSchema({ insideSlot });
        const formContent = (
          <HydraSchemaProvider value={{ blockPathMap, currentBlockId: blockId, formData, blocksConfig: config.blocks?.blocksConfig, liveBlockDataRef, onChangeBlock }}>
            <BlockDataForm
              schema={templateBlockSchema}
              onChangeField={(fieldId, value) => {
                const newBlockData = cloneDeep(blockData);
                if (fieldId === 'kind') {
                  // Map the chosen kind back to its fixed/readOnly flags.
                  const { fixed, readOnly } = blockKindFlags(value);
                  newBlockData.fixed = fixed;
                  newBlockData.readOnly = readOnly;
                } else {
                  newBlockData[fieldId] = value;
                }
                onChangeBlock(blockId, newBlockData);
              }}
              formData={templateBlockFormData}
              block={blockId}
              applySchemaEnhancers={false}
            />
          </HydraSchemaProvider>
        );
        // Portal each block's template settings to ITS OWN target — the current
        // block's dedicated #sidebar-template-settings area, a parent's into its own
        // #parent-sidebar-{id} section — the same per-block routing the regular
        // settings use above. A single shared target stacked EVERY hierarchy block's
        // template settings into the current block's area (showing it twice).
        const targetElement = document.getElementById(
          isCurrentBlock ? 'sidebar-template-settings' : `parent-sidebar-${blockId}`,
        );
        return targetElement ? createPortal(formContent, targetElement) : null;
      })()}
    </div>
  );
};

/**
 * ParentBlocksWidget - Main component
 * Renders the parent chain for the selected block with settings forms
 */
const ParentBlocksWidget = ({
  selectedBlock,
  multiSelected = [],
  // blockId → { field: [messages] }, from the last refused save. Volto's
  // InlineForm takes `errors` keyed the same way and marks the field, so the
  // author sees WHICH field is wrong where they would fix it — the toast only
  // names the block.
  blocksErrors = {},
  formData,
  blockPathMap,
  onSelectBlock,
  onDeleteBlock,
  onChangeBlock,
  onBlockAction,
  templateEditMode,
  onChangeTemplateSettings,
  onToggleTemplateEditMode,
  templatePermissions,
}) => {
  const isMultiSelected = multiSelected.length > 1;
  const [isClient, setIsClient] = React.useState(false);
  const prevSelectedBlockRef = React.useRef(null);
  const intl = useIntl();
  const location = useLocation();
  const pathname = location?.pathname || '';

  // Track live block data from each form's internal state
  // This ref is updated synchronously when any block's form changes,
  // so child schemaEnhancers see fresh parent data immediately
  const liveBlockDataRef = React.useRef({});

  // Wrapper that captures block data changes before propagating to parent
  const handleBlockChange = React.useCallback((blockId, newBlockData) => {
    // Skip no-op changes: BlockEdit/BlockDataForm applies schema defaults on
    // mount/update, calling onChangeBlock even when data hasn't actually changed.
    // Without this guard, selecting a block causes parent blocks to re-render
    // (schema defaults → onChangeBlock → onChangeFormData → setState → re-render)
    // which flickers the toolbar/outline.
    const oldData = liveBlockDataRef.current[blockId] ??
      getBlockById(formData, blockPathMap, blockId);
    if (isEqual(oldData, newBlockData)) {
      return;
    }
    // Update ref immediately (synchronous, no React batching)
    liveBlockDataRef.current = { ...liveBlockDataRef.current, [blockId]: newBlockData };
    // Propagate to parent
    onChangeBlock(blockId, newBlockData);
  }, [onChangeBlock, formData, blockPathMap]);

  React.useEffect(() => {
    setIsClient(true);
  }, []);

  // Scroll to current block settings when selection changes
  React.useEffect(() => {
    if (!isClient || !selectedBlock) return;

    // Only scroll when selecting a different block
    if (prevSelectedBlockRef.current === selectedBlock) return;
    prevSelectedBlockRef.current = selectedBlock;

    // Poll until sidebar content has rendered, then scroll
    // This handles async content like Slate editors that render after initial mount
    let attempts = 0;
    const maxAttempts = 20; // 2 seconds max (20 * 100ms)

    const tryScroll = () => {
      attempts++;
      const sidebarProperties = document.getElementById('sidebar-properties');
      const scrollContainer = document.querySelector('.sidebar-content-wrapper');

      if (!sidebarProperties || !scrollContainer) {
        if (attempts < maxAttempts) setTimeout(tryScroll, 100);
        return;
      }

      // Wait until there's actual content inside (not just an empty container)
      // The form or editor content should have rendered
      const hasContent = sidebarProperties.querySelector('form, [role="textbox"]');
      if (!hasContent && attempts < maxAttempts) {
        setTimeout(tryScroll, 100);
        return;
      }

      const containerRect = scrollContainer.getBoundingClientRect();
      const propertiesRect = sidebarProperties.getBoundingClientRect();

      // Calculate scroll needed to show settings from the top
      // We want: as much of settings visible as possible, but top must always be visible
      const propertiesTop = propertiesRect.top;
      const propertiesBottom = propertiesRect.bottom;
      const containerTop = containerRect.top;
      const containerBottom = containerRect.bottom;
      const containerHeight = containerRect.height;
      const propertiesHeight = propertiesRect.height;

      // First, ensure the TOP of settings is visible (scroll up if needed)
      if (propertiesTop < containerTop) {
        // Settings top is above viewport - scroll up to show it
        const scrollAmount = propertiesTop - containerTop;
        scrollContainer.scrollTop += scrollAmount;
      } else if (propertiesTop > containerTop && propertiesHeight <= containerHeight) {
        // Settings fit entirely - scroll to show from top with some padding
        const scrollAmount = propertiesTop - containerTop - 10;
        if (scrollAmount > 0) {
          scrollContainer.scrollTop += scrollAmount;
        }
      } else if (propertiesTop > containerTop && propertiesHeight > containerHeight) {
        // Settings are taller than viewport - scroll to show top
        const scrollAmount = propertiesTop - containerTop - 10;
        if (scrollAmount > 0) {
          scrollContainer.scrollTop += scrollAmount;
        }
      }
    };

    // Start polling after a small delay for initial React render
    setTimeout(tryScroll, 100);
  }, [isClient, selectedBlock]);

  if (!isClient) {
    return null;
  }
  const parentsTarget = document.getElementById('sidebar-parents');
  if (!parentsTarget) {
    return null;
  }

  // Page-level or no selection: still render the multi-select bar if any
  if (!selectedBlock || selectedBlock === PAGE_BLOCK_UID) {
    if (multiSelected.length > 0) {
      const commonAncestor = getCommonAncestor(blockPathMap, multiSelected);
      return createPortal(
        <div className="multi-select-bar" style={{
          padding: '8px 12px',
          background: '#e8f4fd',
          borderTop: '1px solid #007eb1',
          fontSize: '13px',
          color: '#007eb1',
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>
            {multiSelected.length} selected
          </div>
          {multiSelected.map((uid) => {
            const pathSegments = [];
            let current = uid;
            while (current && current !== commonAncestor && current !== PAGE_BLOCK_UID) {
              pathSegments.unshift(getBlockTypeTitle(blockPathMap[current]?.blockType, blockPathMap, current));
              current = blockPathMap[current]?.parentId;
            }
            return (
              <div
                key={uid}
                className="selected-block-path"
                style={{
                  padding: '4px 8px', margin: '2px 0',
                  background: 'white', borderRadius: '3px',
                  fontSize: '12px', cursor: 'pointer',
                }}
                onClick={() => onSelectBlock(uid)}
              >
                {pathSegments.join(' > ')}
              </div>
            );
          })}
        </div>,
        parentsTarget,
      );
    }
    return null;
  }

  // Get parent chain
  const parentIds = getParentChain(selectedBlock, blockPathMap);

  // Get current block data and type from blockPathMap (single source of truth)
  // For virtual blocks (like template instances), use blockData from pathMap
  const pathInfo = blockPathMap[selectedBlock];
  const currentBlockData = pathInfo?.blockData || getBlockById(formData, blockPathMap, selectedBlock);
  const currentBlockType = pathInfo?.blockType;

  // Guard: If block data is undefined, skip rendering (data may be out of sync during drag operations)
  if (!currentBlockData) {
    console.warn('[ParentBlocksWidget] Block data undefined for:', selectedBlock, 'blockPathMap entry:', pathInfo);
    return null;
  }

  return (
    <>
      {createPortal(
        <>
          {/* The template edit toggle is no longer a standalone button here — it now
              lives as a lock/unlock icon on the template instance's header bar (and in
              that bar's ⋯ dropdown), plus the Quanta toolbar lock in-canvas. */}
          {/* Parent blocks with headers + settings */}
          {parentIds.map((parentId, index) => {
            // For virtual blocks (like template instances), use blockData from pathMap
            const parentPathInfo = blockPathMap[parentId];
            const parentData = parentPathInfo?.blockData || getBlockById(formData, blockPathMap, parentId);
            const parentType = parentPathInfo?.blockType;
            // Parent of this parent (or null if root)
            const grandparentId = index > 0 ? parentIds[index - 1] : null;

            return (
              <ParentBlockSection
                key={parentId}
                blocksErrors={blocksErrors}
                blockId={parentId}
                blockType={parentType}
                blockData={parentData}
                templatePermissions={templatePermissions}
                parentId={grandparentId}
                index={index}
                isCurrentBlock={false}
                onSelectBlock={onSelectBlock}
                onDeleteBlock={onDeleteBlock}
                onChangeBlock={handleBlockChange}
                onBlockAction={onBlockAction}
                formData={formData}
                pathname={pathname}
                intl={intl}
                blockPathMap={blockPathMap}
                liveBlockDataRef={liveBlockDataRef}
                templateEditMode={templateEditMode}
                onChangeTemplateSettings={onChangeTemplateSettings}
                onToggleTemplateEditMode={onToggleTemplateEditMode}
              />
            );
          })}

          {/* Current block form (ChildBlocksWidget renders inside its schema fields) */}
          <ParentBlockSection
            key={selectedBlock}
            blocksErrors={blocksErrors}
            blockId={selectedBlock}
            blockType={currentBlockType}
            blockData={currentBlockData}
            templatePermissions={templatePermissions}
            parentId={parentIds.length > 0 ? parentIds[parentIds.length - 1] : null}
            index={parentIds.length}
            isCurrentBlock={true}
            onSelectBlock={onSelectBlock}
            onDeleteBlock={onDeleteBlock}
            onChangeBlock={handleBlockChange}
            onBlockAction={onBlockAction}
            formData={formData}
            pathname={pathname}
            intl={intl}
            blockPathMap={blockPathMap}
            liveBlockDataRef={liveBlockDataRef}
            templateEditMode={templateEditMode}
            onChangeTemplateSettings={onChangeTemplateSettings}
            onToggleTemplateEditMode={onToggleTemplateEditMode}
          />

          {/* Multi-select summary bar at bottom of sidebar, below ChildBlocksWidget */}
          {multiSelected.length > 0 && (() => {
            const commonAncestor = getCommonAncestor(blockPathMap, multiSelected);
            return (
              <div className="multi-select-bar" style={{
                padding: '8px 12px',
                background: '#e8f4fd',
                borderTop: '1px solid #007eb1',
                fontSize: '13px',
                color: '#007eb1',
              }}>
                <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>
                  {multiSelected.length} selected
                </div>
                {multiSelected.map((uid) => {
                  const pathSegments = [];
                  let current = uid;
                  while (current && current !== commonAncestor && current !== PAGE_BLOCK_UID) {
                    pathSegments.unshift(getBlockTypeTitle(blockPathMap[current]?.blockType, blockPathMap, current));
                    current = blockPathMap[current]?.parentId;
                  }
                  return (
                    <div
                      key={uid}
                      className="selected-block-path"
                      style={{
                        padding: '4px 8px',
                        margin: '2px 0',
                        background: 'white',
                        borderRadius: '3px',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                      onClick={() => onSelectBlock(uid)}
                    >
                      {pathSegments.join(' > ')}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </>,
        parentsTarget,
      )}
    </>
  );
};

ParentBlocksWidget.propTypes = {
  selectedBlock: PropTypes.string,
  formData: PropTypes.object,
  blockPathMap: PropTypes.object,
  onSelectBlock: PropTypes.func,
  onDeleteBlock: PropTypes.func,
  onChangeBlock: PropTypes.func,
  onBlockAction: PropTypes.func,
};

export default ParentBlocksWidget;
