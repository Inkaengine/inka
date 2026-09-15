/**
 * ChildBlocksWidget - Shows child blocks for each container field in the current block.
 * A block can have multiple `widget: 'blocks_layout'` fields, each rendered as a separate section.
 *
 * Example: A block with both 'slides' and 'footnotes' fields would show:
 *   Slides        [+]
 *   ⋮⋮ Slide 1     >
 *   ⋮⋮ Slide 2     >
 *
 *   Footnotes     [+]
 *   ⋮⋮ Note 1      >
 *   ⋮⋮ Note 2      >
 */

import React from 'react';
import PropTypes from 'prop-types';
import { createPortal } from 'react-dom';
import { defineMessages, useIntl } from 'react-intl';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { Icon } from '@plone/volto/components';
import { setUIState } from '@plone/volto/actions';
import rightArrowSVG from '@plone/volto/icons/right-key.svg';
import config from '@plone/volto/registry';
import { blockDisplayTitle } from '../../utils/blockDisplayTitle';
import { DragDropList } from '@plone/volto/components';
import {
  getAllContainerFields,
  getBlockById,
  listContainerChildren,
  getContainerItems,
} from '../../utils/blockPath';
import { PAGE_BLOCK_UID } from '@volto-hydra/hydra-js';
import { isBlockPositionLocked } from '@volto-hydra/helpers';
import LayoutSelector from './LayoutSelector';

const messages = defineMessages({
  blocks: {
    id: 'Blocks',
    defaultMessage: 'Blocks',
  },
  addBlock: {
    id: 'Add block',
    defaultMessage: 'Add block',
  },
});

/**
 * Get child blocks for a specific container field
 * Supports both standard containers (blocks + blocks_layout) and object_list (array with @id)
 * @param {Array|null} dataPath - Path to actual data location (e.g., ['table', 'rows'])
 */
// Presentation: derive a display title from a storage-agnostic child
// descriptor ({ id, type, data }) produced by listContainerChildren.
const childDisplayTitle = (child, isObjectList, index) => {
  // The shared namer, so a block reads the same here as in any picker that
  // offers it. An untyped object_list item has no type to fall back on, hence
  // its position; everything else can name itself.
  const fallback =
    isObjectList && child.type === 'object_list_item'
      ? `Item ${index + 1}`
      : child.type;
  return blockDisplayTitle(
    { '@type': child.type, ...child.data },
    { fallback },
  );
};

// Children of a selected block's container. Storage shape (region / object_list
// / dataPath) is hidden by listContainerChildren; we only add the display title.
const getChildBlocks = (blockData, containerConfig) =>
  listContainerChildren(blockData, containerConfig).map((child, index) => ({
    ...child,
    title: childDisplayTitle(child, containerConfig.isObjectList, index),
  }));

/**
 * Get the display title for a block
 */
const getBlockTitle = (blockData) =>
  // The same namer as everywhere else, with one rule kept: a FIXED template
  // block is identified by its words, not by its type — every fixed heading in
  // a template is a "Heading", and the author is looking for a particular one.
  blockDisplayTitle(blockData, {
    labelField: blockData?.fixed ? 'plaintext' : undefined,
  });

/**
 * Group template instance children into sections by slotId.
 * Produces a sequence of:
 * - { type: 'fixed', block } — standalone fixed block (no drag)
 * - { type: 'slot', name, blocks: [...], precedingFixedId } — slot region
 *
 * Also inserts empty slot sections for nextSlotId on fixed blocks
 * when all blocks in that region were deleted.
 */
const groupByPlaceholder = (childBlocks, templateEditMode) => {
  const sections = [];
  let currentSlot = null;

  for (const child of childBlocks) {
    const isLocked = isBlockPositionLocked(child.data, templateEditMode);

    if (isLocked) {
      currentSlot = null;
      sections.push({ type: 'fixed', block: child });
    } else {
      const slotName = child.data?.slotId || 'content';
      if (!currentSlot || currentSlot.name !== slotName) {
        currentSlot = { type: 'slot', name: slotName, blocks: [] };
        sections.push(currentSlot);
      }
      currentSlot.blocks.push(child);
    }
  }

  // Insert empty slot sections for fixed blocks with nextSlotId
  // when all blocks in the region were deleted
  const result = [];
  for (let i = 0; i < sections.length; i++) {
    // Leading empty slot (prevSlotId): a fixed block whose slot region BEFORE it is empty
    // (bottom-anchored layout — slots above a fixed footer). Insert the empty slot section
    // in front of it. Mirror of the trailing nextSlotId case below.
    if (sections[i].type === 'fixed') {
      const prevPh = sections[i].block.data?.prevSlotId;
      if (prevPh) {
        const prev = result[result.length - 1];
        if (!prev || prev.type !== 'slot' || prev.name !== prevPh) {
          result.push({ type: 'slot', name: prevPh, blocks: [] });
        }
      }
    }
    result.push(sections[i]);
    if (sections[i].type === 'fixed') {
      const nextPh = sections[i].block.data?.nextSlotId;
      if (nextPh) {
        const next = sections[i + 1];
        if (!next || next.type !== 'slot' || next.name !== nextPh) {
          result.push({
            type: 'slot',
            name: nextPh,
            blocks: [],
            precedingFixedId: sections[i].block.id,
          });
        }
      }
    }
  }

  // Set precedingFixedId on all slot sections (for add-after when section has blocks too)
  for (let i = 0; i < result.length; i++) {
    if (result[i].type === 'slot' && !result[i].precedingFixedId) {
      // Look back for the nearest fixed block
      for (let j = i - 1; j >= 0; j--) {
        if (result[j].type === 'fixed') {
          result[i].precedingFixedId = result[j].block.id;
          break;
        }
      }
    }
  }

  return result;
};

/**
 * Single container field section
 */
const ContainerFieldSection = ({
  region,
  containerConfig,
  fieldTitle,
  childBlocks,
  allowedBlocks,
  allowedTemplates,
  allowedLayouts,
  canAdd, // From getAllContainerFields - considers readonly, maxLength, etc.
  onSelectBlock,
  onAddBlock,
  onMoveBlock,
  parentBlockId,
  formData,
  onChangeFormData,
  blockPathMap,
}) => {
  const intl = useIntl();
  const dispatch = useDispatch();
  const store = useStore();
  const selected = useSelector((state) => state.form.ui.selected);
  const multiSelected =
    useSelector((state) => state.form.ui.multiSelected) || [];
  // Read fresh multiSelected from the store at click time. Two ctrl+clicks
  // fired in quick succession would otherwise both close over the
  // pre-first-click `multiSelected` value (React hasn't committed the
  // re-render between Playwright clicks), and the second dispatch would
  // overwrite the first instead of appending.
  const getCurrentMultiSelected = () =>
    store.getState().form.ui.multiSelected || [];

  // Convert childBlocks to format expected by DragDropList: [[id, data], ...]
  const childList = childBlocks.map((child) => [child.id, child]);

  const handleMoveItem = (result) => {
    const { source, destination } = result;
    if (!destination || source.index === destination.index) return;

    // Get the block IDs in current order
    const blockIds = childBlocks.map((child) => child.id);
    const [movedId] = blockIds.splice(source.index, 1);
    blockIds.splice(destination.index, 0, movedId);

    // Call the move handler with the new order
    onMoveBlock(parentBlockId, region, blockIds);
  };

  return (
    <div className="container-field-section">
      <div className="widget-header">
        <span className="widget-title">{fieldTitle}</span>
        <div className="widget-actions">
          {onChangeFormData && allowedLayouts?.length > 0 && (
            <LayoutSelector
              formData={formData}
              onChangeFormData={onChangeFormData}
              allowedLayouts={allowedLayouts}
              targetBlockId={parentBlockId}
            />
          )}
          {canAdd && (
            <button
              onClick={() => onAddBlock(parentBlockId, containerConfig)}
              title={intl.formatMessage(messages.addBlock)}
              aria-label={intl.formatMessage(messages.addBlock)}
            >
              +
            </button>
          )}
        </div>
      </div>
      <div className="child-blocks-list">
        {childBlocks.length > 0 ? (
          <DragDropList childList={childList} onMoveItem={handleMoveItem}>
            {({ child, draginfo }) => (
              <div
                ref={draginfo.innerRef}
                {...draginfo.draggableProps}
                className={`child-block-item${multiSelected.includes(child.id) ? ' selected' : ''}`}
                style={
                  multiSelected.includes(child.id)
                    ? { background: '#e8f4fd' }
                    : undefined
                }
                onClick={(e) => {
                  // Read the latest multiSelected from the store rather
                  // than the closure — see getCurrentMultiSelected above.
                  const current = getCurrentMultiSelected();
                  if (e.shiftKey) {
                    // Shift+Click: select range from anchor to clicked
                    const siblingIds = childBlocks.map((c) => c.id);
                    const anchor = current.length > 0 ? current[0] : selected;
                    const anchorIdx = siblingIds.indexOf(anchor);
                    const focusIdx = siblingIds.indexOf(child.id);
                    if (anchorIdx >= 0 && focusIdx >= 0) {
                      const start = Math.min(anchorIdx, focusIdx);
                      const end = Math.max(anchorIdx, focusIdx);
                      dispatch(
                        setUIState({
                          selected: null,
                          multiSelected: siblingIds.slice(start, end + 1),
                        }),
                      );
                    }
                  } else if (e.ctrlKey || e.metaKey) {
                    // Ctrl/Cmd+Click: toggle in/out of multi-selection
                    if (current.includes(child.id)) {
                      dispatch(
                        setUIState({
                          multiSelected: current.filter(
                            (uid) => uid !== child.id,
                          ),
                        }),
                      );
                    } else {
                      dispatch(
                        setUIState({ multiSelected: [...current, child.id] }),
                      );
                    }
                    // Enter selection mode — iframe shows checkboxes
                    document.dispatchEvent(
                      new CustomEvent('hydra-enter-selection-mode'),
                    );
                  } else if (current.length > 0) {
                    // Selection mode: plain click toggles (don't navigate)
                    if (current.includes(child.id)) {
                      dispatch(
                        setUIState({
                          multiSelected: current.filter(
                            (uid) => uid !== child.id,
                          ),
                        }),
                      );
                    } else {
                      dispatch(
                        setUIState({ multiSelected: [...current, child.id] }),
                      );
                    }
                  } else {
                    onSelectBlock(child.id);
                  }
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onSelectBlock(child.id);
                  }
                }}
              >
                <span className="drag-handle" {...draginfo.dragHandleProps}>
                  ⋮⋮
                </span>
                <span className="block-type">{child.title}</span>
                <span
                  className="nav-arrow-wrapper"
                  role="button"
                  aria-label="Navigate into block"
                  onClick={(e) => {
                    // Arrow always navigates — even in selection mode
                    e.stopPropagation();
                    onSelectBlock(child.id);
                  }}
                >
                  <Icon
                    className="nav-arrow"
                    name={rightArrowSVG}
                    size="24px"
                  />
                </span>
              </div>
            )}
          </DragDropList>
        ) : (
          <div className="empty-container-message">No blocks yet</div>
        )}
      </div>
    </div>
  );
};

/**
 * Get child blocks for a page-level field
 */
// Page-level container children. The page formData is the "parent block"
// (its shared `blocks` dict holds every region's blocks).
const getChildBlocksForPageField = (formData, fieldConfig) =>
  listContainerChildren(formData, fieldConfig).map((child) => ({
    ...child,
    title: getBlockTitle(child.data),
  }));

/**
 * ChildBlocksWidget - Main component
 * Renders all container fields for the current block
 */
const ChildBlocksWidget = ({
  selectedBlock,
  formData,
  blockPathMap,
  onSelectBlock,
  onAddBlock,
  onMoveBlock,
  onChangeFormData,
  templateEditMode,
}) => {
  const intl = useIntl();
  const blocksConfig = config.blocks?.blocksConfig;
  const [isClient, setIsClient] = React.useState(false);

  React.useEffect(() => {
    setIsClient(true);
  }, []);

  // If no block selected, show page-level blocks for each page field
  // Uses getAllContainerFields(PAGE_BLOCK_UID, ...) to get _page container fields
  if (!selectedBlock) {
    const fieldsConfig = getAllContainerFields(
      PAGE_BLOCK_UID,
      blockPathMap,
      formData,
      blocksConfig,
      intl,
      templateEditMode,
    );

    if (!isClient) return null;

    // Note: Uses sidebar-order for backwards compatibility with tests
    const target = document.getElementById('sidebar-order');
    if (!target) return null;

    return createPortal(
      <div className="child-blocks-widget page-blocks-fields">
        {fieldsConfig.map((fieldConfig) => {
          const childBlocks = getChildBlocksForPageField(formData, fieldConfig);
          return (
            <ContainerFieldSection
              key={fieldConfig.region || 'items'}
              region={fieldConfig.region}
              containerConfig={fieldConfig}
              fieldTitle={
                fieldConfig.title || intl.formatMessage(messages.blocks)
              }
              childBlocks={childBlocks}
              allowedBlocks={fieldConfig.allowedBlocks}
              allowedTemplates={fieldConfig.allowedTemplates}
              allowedLayouts={fieldConfig.allowedLayouts}
              canAdd={fieldConfig.canAdd}
              onSelectBlock={onSelectBlock}
              onAddBlock={onAddBlock}
              onMoveBlock={onMoveBlock}
              parentBlockId={PAGE_BLOCK_UID}
              formData={formData}
              onChangeFormData={onChangeFormData}
              blockPathMap={blockPathMap}
            />
          );
        })}
      </div>,
      target,
    );
  }

  // Use shared helper to get all container fields (supports multiple and implicit)
  const containerFields = getAllContainerFields(
    selectedBlock,
    blockPathMap,
    formData,
    blocksConfig,
    intl,
    templateEditMode,
  );

  // If no container fields, don't render anything
  if (containerFields.length === 0) return null;

  if (!isClient) return null;

  // Note: Uses sidebar-order for backwards compatibility with tests
  const target = document.getElementById('sidebar-order');
  if (!target) return null;

  // Get the block data for retrieving children (use virtual blockData for template instances)
  const pathInfo = blockPathMap[selectedBlock];
  const blockData =
    pathInfo?.blockData || getBlockById(formData, blockPathMap, selectedBlock);

  return createPortal(
    <div className="child-blocks-widget">
      {containerFields.map((field) => {
        // For template instances, group children by slotId
        if (field.isTemplateInstance) {
          const childIds = Object.entries(blockPathMap)
            .filter(([, info]) => info.parentId === selectedBlock)
            .map(([id]) => id);
          const childBlocks = childIds.map((childId) => {
            const childPathInfo = blockPathMap[childId];
            const childData = getBlockById(formData, blockPathMap, childId);
            const blockType = childPathInfo?.blockType || 'unknown';
            const title = blockDisplayTitle(
              { '@type': blockType, ...childData },
              { fallback: blockType },
            );
            return { id: childId, type: blockType, title, data: childData };
          });

          const sections = groupByPlaceholder(childBlocks, templateEditMode);
          const instanceInfo = blockPathMap[selectedBlock];
          const realParentId = instanceInfo?.parentId;
          const realRegion = instanceInfo?.region || 'items';

          return sections.map((section, sectionIdx) => {
            if (section.type === 'fixed') {
              // Fixed block: clickable, no drag handle
              return (
                <div
                  key={section.block.id}
                  className="child-block-item fixed-block-item"
                  onClick={() => onSelectBlock(section.block.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      onSelectBlock(section.block.id);
                    }
                  }}
                >
                  <span className="block-type">{section.block.title}</span>
                  <Icon
                    className="nav-arrow"
                    name={rightArrowSVG}
                    size="24px"
                  />
                </div>
              );
            }

            // Placeholder section: reuse ContainerFieldSection
            const sectionBlockIds = section.blocks.map((b) => b.id);

            // Wrap onMoveBlock to translate section reorder → full layout reorder
            const wrappedMoveBlock = (
              _parentBlockId,
              _fieldName,
              reorderedIds,
            ) => {
              const realParent =
                realParentId === PAGE_BLOCK_UID
                  ? formData
                  : getBlockById(formData, blockPathMap, realParentId);
              // Read the instance's region via the funnel — no direct storage indexing.
              const fullLayout = getContainerItems(realParent, {
                region: realRegion,
              });
              let idx = 0;
              const newLayout = fullLayout.map((id) =>
                sectionBlockIds.includes(id) ? reorderedIds[idx++] : id,
              );
              onMoveBlock(realParentId, realRegion, newLayout);
            };

            // Wrap onAddBlock to insert after last block in section (or preceding fixed block)
            const wrappedAddBlock = () => {
              const afterBlockId =
                section.blocks.length > 0
                  ? section.blocks[section.blocks.length - 1].id
                  : section.precedingFixedId;
              if (afterBlockId) {
                onAddBlock(null, null, { afterBlockId });
              }
            };

            const slotTitle =
              section.name.charAt(0).toUpperCase() + section.name.slice(1);
            return (
              <ContainerFieldSection
                key={`slot-${section.name}-${sectionIdx}`}
                region={realRegion}
                fieldTitle={slotTitle}
                childBlocks={section.blocks}
                canAdd={true}
                onSelectBlock={onSelectBlock}
                onAddBlock={wrappedAddBlock}
                onMoveBlock={wrappedMoveBlock}
                parentBlockId={realParentId}
                formData={formData}
                onChangeFormData={onChangeFormData}
                blockPathMap={blockPathMap}
              />
            );
          });
        }

        // Standard container field
        const childBlocks = getChildBlocks(blockData, field);
        return (
          <ContainerFieldSection
            key={field.region || 'items'}
            region={field.region}
            containerConfig={field}
            fieldTitle={field.title}
            childBlocks={childBlocks}
            allowedBlocks={field.allowedBlocks}
            allowedTemplates={field.allowedTemplates}
            allowedLayouts={field.allowedLayouts}
            canAdd={field.canAdd}
            onSelectBlock={onSelectBlock}
            onAddBlock={onAddBlock}
            onMoveBlock={onMoveBlock}
            parentBlockId={selectedBlock}
            formData={formData}
            onChangeFormData={onChangeFormData}
            blockPathMap={blockPathMap}
          />
        );
      })}
    </div>,
    target,
  );
};

ChildBlocksWidget.propTypes = {
  selectedBlock: PropTypes.string,
  formData: PropTypes.object,
  blockPathMap: PropTypes.object,
  onSelectBlock: PropTypes.func,
  onAddBlock: PropTypes.func,
  onMoveBlock: PropTypes.func,
  onChangeFormData: PropTypes.func,
  templateEditMode: PropTypes.arrayOf(PropTypes.string),
};

export default ChildBlocksWidget;
