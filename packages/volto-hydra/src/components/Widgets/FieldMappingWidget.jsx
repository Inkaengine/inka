/**
 * FieldMappingWidget - Configure source → target field mappings
 *
 * Used by blocks that populate child blocks from external data (e.g., listing blocks).
 * Maps query result fields to target block type fields.
 *
 * Example: Map "title" from query results to "headline" field in teaser blocks.
 */
import { useIntl } from 'react-intl';
import config from '@plone/volto/registry';
import FormFieldWrapper from '@plone/volto/components/manage/Widgets/FormFieldWrapper';
import {
  customSelectStyles,
  DropdownIndicator,
  selectTheme,
} from '@plone/volto/components/manage/Widgets/SelectStyling';
import { injectLazyLibs } from '@plone/volto/helpers/Loadable/Loadable';
import {
  getBlockTypeSchema,
  computeSmartDefaults,
  getFieldType,
  findTypeField,
} from '../../utils/blockSync';
import { useHydraSchemaContext } from '../../context/HydraSchemaContext';
import { getBlockById } from '../../utils/blockPath';

/**
 * Get schema fields for a block type as options for a select
 */
const getBlockSchemaFields = (blockType, intl, blocksConfig) => {
  const schema = getBlockTypeSchema(blockType, intl, blocksConfig);
  if (!schema?.properties) return [];

  return Object.entries(schema.properties).map(([fieldName, fieldDef]) => ({
    value: fieldName,
    label: fieldDef.title || fieldName,
  }));
};

const FieldMappingWidget = (props) => {
  const {
    id,
    value = {},       // { sourceField: targetField, ... }
    onChange,
    sourceFields,     // { fieldName: { title: "Field Title" }, ... }
    block,            // Block UID (passed by InlineForm)
    reactSelect,
  } = props;

  // Get block data from HydraSchemaContext (InlineForm doesn't pass formData)
  const hydraCtx = useHydraSchemaContext();
  const blockData = (() => {
    if (!hydraCtx || !block) return null;
    // Check liveBlockDataRef first for fresh form data
    if (hydraCtx.liveBlockDataRef?.current?.[block]) {
      return hydraCtx.liveBlockDataRef.current[block];
    }
    // Fall back to page-level formData
    return getBlockById(hydraCtx.formData, hydraCtx.blockPathMap, block);
  })();

  const intl = useIntl();
  const Select = reactSelect.default;

  // Resolve typeField via the standard lookup (recipe → schema walk → legacy)
  const blockType = blockData?.['@type'];
  const itemTypeField = findTypeField(
    config.blocks.blocksConfig[blockType],
    intl,
  );
  const targetType = blockData?.[itemTypeField];

  // Get target schema and compute smart defaults
  const blocksConfig = config.blocks.blocksConfig;
  const targetSchema = getBlockTypeSchema(targetType, intl, blocksConfig);
  const childFieldMappings = blocksConfig[targetType]?.fieldMappings;
  const smartDefaults = sourceFields && targetSchema
    ? computeSmartDefaults(sourceFields, targetSchema, childFieldMappings)
    : {};

  // Filter out any saved mappings that reference fields not in the current target type
  // Handle both legacy format (string) and new format ({ field, type })
  const validTargetFields = new Set(Object.keys(targetSchema?.properties || {}));
  const filteredValue = Object.fromEntries(
    Object.entries(value || {}).filter(([, mapping]) => {
      const targetField = typeof mapping === 'string' ? mapping : mapping?.field;
      return validTargetFields.has(targetField);
    })
  );

  // Use smart defaults for any unmapped fields, filtered values override defaults
  // Note: The schemaEnhancer (inheritSchemaFrom) handles atomic updates to formData
  // when itemType changes, so we don't need a useEffect here
  const effectiveValue = { ...smartDefaults, ...filteredValue };

  // Get available target fields from block schema
  const targetFieldOptions = [
    { value: '', label: '(none)' },
    ...getBlockSchemaFields(targetType, intl, blocksConfig),
  ];

  // Handle change for a specific source field
  // Stores { field, type } for link/image target fields, plain string otherwise
  const handleChange = (sourceKey, targetValue) => {
    const newValue = { ...value };
    if (targetValue) {
      const fieldDef = targetSchema?.properties?.[targetValue];
      const fieldType = getFieldType(fieldDef);
      if (fieldType === 'link' || fieldType === 'image') {
        newValue[sourceKey] = { field: targetValue, type: fieldType };
      } else {
        newValue[sourceKey] = targetValue;
      }
    } else {
      delete newValue[sourceKey];
    }
    onChange(id, newValue);
  };

  if (!sourceFields || Object.keys(sourceFields).length === 0) {
    return (
      <FormFieldWrapper {...props} columns={1}>
        <p className="help">No source fields defined.</p>
      </FormFieldWrapper>
    );
  }

  if (!targetType) {
    return (
      <FormFieldWrapper {...props} columns={1}>
        <p className="help">Select a block type first to configure field mappings.</p>
      </FormFieldWrapper>
    );
  }

  return (
    <FormFieldWrapper {...props} columns={1}>
      <table className="field-mapping-table" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '4px 8px' }}>Source</th>
            <th style={{ width: '30px', textAlign: 'center' }}>→</th>
            <th style={{ textAlign: 'left', padding: '4px 8px' }}>Target</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(sourceFields).map(([sourceKey, sourceDef]) => (
            <tr key={sourceKey}>
              <td style={{ padding: '4px 8px', verticalAlign: 'middle' }}>
                {sourceDef.title || sourceKey}
              </td>
              <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>→</td>
              <td style={{ padding: '4px 8px' }}>
                <Select
                  value={targetFieldOptions.find(
                    (opt) => {
                      const mapping = effectiveValue?.[sourceKey];
                      const targetField = typeof mapping === 'string' ? mapping : mapping?.field;
                      return opt.value === targetField;
                    },
                  )}
                  options={targetFieldOptions}
                  onChange={(selected) =>
                    handleChange(sourceKey, selected?.value || '')
                  }
                  styles={customSelectStyles}
                  theme={selectTheme}
                  components={{ DropdownIndicator }}
                  classNamePrefix="react-select"
                  isClearable
                  placeholder="(none)"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </FormFieldWrapper>
  );
};

export default injectLazyLibs(['reactSelect'])(FieldMappingWidget);
