/**
 * BlockTypeSelectWidget — select field whose choices are computed from
 * the surrounding block's allowedBlocks at render time.
 *
 * Use on a typeField (the field whose value drives child @types in a
 * sync setup). Saves you from keeping a static `choices` array in lockstep
 * with the block's `allowedBlocks`.
 *
 * Field options (set on the schema field alongside `widget: 'blockTypeSelect'`):
 *   - blocksField: which sub-blocks field's allowedBlocks to use. Optional —
 *     auto-discovers if omitted. Set to '..' to use enclosing parent's
 *     allowedSiblingTypes (this block IS the item being typed).
 *   - filterConvertibleFrom: only offer types whose fieldMappings accept
 *     the named source (e.g., '@default' for listings).
 *   - default: the preferred type, kept where the choices include it.
 *
 * These are the only place the options are declared: the inheritSchemaFrom
 * recipe reads them from this field too, to store the type the position allows
 * as the block lands (and refuses a recipe that declares them).
 *
 * Usage:
 *   blockSchema: {
 *     properties: {
 *       variation: {
 *         widget: 'blockTypeSelect',
 *         filterConvertibleFrom: '@default',
 *         title: 'Item Type',
 *       },
 *     },
 *   }
 */
import React from 'react';
import { useIntl } from 'react-intl';
import config from '@plone/volto/registry';
import { getBlockTypeChoices } from '../../utils/blockSync';
import { useHydraSchemaContext } from '../../context/HydraSchemaContext';
import { getBlockById } from '../../utils/blockPath';

const BlockTypeSelectWidget = (props) => {
  const { block, filterConvertibleFrom, blocksField } = props;

  const hydraCtx = useHydraSchemaContext();
  const intl = useIntl();
  const blocksConfig = config.blocks.blocksConfig;
  const blockId = block || hydraCtx?.currentBlockId;

  const formData = (() => {
    if (!hydraCtx || !blockId) return null;
    if (hydraCtx.liveBlockDataRef?.current?.[blockId]) {
      return hydraCtx.liveBlockDataRef.current[blockId];
    }
    return getBlockById(hydraCtx.formData, hydraCtx.blockPathMap, blockId);
  })();

  const choices = getBlockTypeChoices(
    { filterConvertibleFrom, blocksField },
    blocksConfig,
    hydraCtx?.blockPathMap,
    blockId,
    formData,
    intl,
  );

  // Use Volto's registered SelectWidget — the registry copy is the same
  // HOC-composed component Volto uses for `widget: 'select'` fields. Reading
  // it from the registry (rather than importing the ESM module directly)
  // keeps the wrapping consistent with Volto's normal rendering path.
  const SelectWidget = config.widgets.widget.select;

  return <SelectWidget {...props} choices={choices} />;
};

export default BlockTypeSelectWidget;
