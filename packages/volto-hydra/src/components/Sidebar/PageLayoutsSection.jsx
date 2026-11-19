/**
 * The page's layouts, as a section of its settings (beside Preview image and
 * SEO): one row per page region that allows layouts, with that region's
 * layout choice. Page settings are in the sidebar whatever is selected, so a
 * layout can be switched from anywhere; the page's Regions list (its blocks)
 * no longer carries the choice. A locked layout's own section offers it too.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { useIntl } from 'react-intl';
import { Accordion, Segment } from 'semantic-ui-react';
import { Icon } from '@plone/volto/components';
import config from '@plone/volto/registry';
import upSVG from '@plone/volto/icons/up-key.svg';
import downSVG from '@plone/volto/icons/down-key.svg';
import { PAGE_BLOCK_UID } from '@volto-hydra/hydra-js';
import { getAllContainerFields } from '../../utils/blockPath';
import LayoutSelector from './LayoutSelector';

const PageLayoutsSection = ({
  formData,
  blockPathMap,
  templateEditMode,
  onChangeFormData,
}) => {
  const intl = useIntl();
  const [open, setOpen] = React.useState(true);
  const [isClient, setIsClient] = React.useState(false);
  React.useEffect(() => setIsClient(true), []);
  if (!isClient || !blockPathMap) return null;
  const target = document.getElementById('sidebar-layouts');
  if (!target) return null;

  const regions = getAllContainerFields(
    PAGE_BLOCK_UID,
    blockPathMap,
    formData,
    config.blocks.blocksConfig,
    intl,
    templateEditMode,
  ).filter((field) => field.allowedLayouts?.length > 0);
  if (regions.length === 0) return null;

  return createPortal(
    <Accordion fluid styled className="form page-layouts">
      <Accordion.Title active={open} onClick={() => setOpen(!open)}>
        Layouts
        <Icon name={open ? upSVG : downSVG} size="20px" />
      </Accordion.Title>
      <Accordion.Content active={open}>
        <Segment className="attached">
          {regions.map((field) => (
            <div
              key={field.region || 'items'}
              className="page-layout-row"
              data-region={field.region || 'items'}
            >
              <span className="page-layout-region">
                {field.title || field.region}
              </span>
              <LayoutSelector
                formData={formData}
                onChangeFormData={onChangeFormData}
                allowedLayouts={field.allowedLayouts}
                region={field.region || 'items'}
              />
            </div>
          ))}
        </Segment>
      </Accordion.Content>
    </Accordion>,
    target,
  );
};

export default PageLayoutsSection;
