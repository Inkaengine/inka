/**
 * Shadow of ObjectBrowserNav.jsx
 * Changes from original:
 * 1. Radio (single-select) / Checkbox (multiple) controls for explicit selection
 * 2. Loading spinner when currentSearchResults?.loading
 * 3. Chevron icon on folderish items (visual hint that row navigates)
 * 4. Removed right-arrow-link-mode button (row click always navigates for folders)
 * 5. Removed handleDoubleClickOnItem (no longer needed)
 */
import React from 'react';
import { Segment, Popup, Loader } from 'semantic-ui-react';
import { useIntl, defineMessages } from 'react-intl';
import cx from 'classnames';
import Icon from '@plone/volto/components/theme/Icon/Icon';
import Image from '@plone/volto/components/theme/Image/Image';
import { flattenToAppURL } from '@plone/volto/helpers/Url/Url';
import { getContentIcon } from '@plone/volto/helpers/Content/Content';
import config from '@plone/volto/registry';

import rightArrowSVG from '@plone/volto/icons/right-key.svg';
import homeSVG from '@plone/volto/icons/home.svg';

const messages = defineMessages({
  browse: {
    id: 'Browse',
    defaultMessage: 'Browse',
  },
  select: {
    id: 'Select',
    defaultMessage: 'Select',
  },
  loading: {
    id: 'Loading',
    defaultMessage: 'Loading...',
  },
});

const ObjectBrowserNav = ({
  currentSearchResults,
  selected,
  handleClickOnItem,
  handleSelectItem,
  mode,
  view,
  navigateTo,
  isSelectable,
}) => {
  const intl = useIntl();
  const isSelected = (item) => {
    let ret = false;
    if (selected && Array.isArray(selected)) {
      selected
        .filter((item) => item != null)
        .forEach((_item) => {
          if (flattenToAppURL(_item['@id']) === flattenToAppURL(item['@id'])) {
            ret = true;
          }
        });
    }
    return ret;
  };

  const isLoading = currentSearchResults?.loading;
  const hasItems = currentSearchResults?.items?.length > 0;

  /**
   * Determine if an item can be selected (not just navigated to).
   * In image mode: only image types are selectable.
   * In link/multiple mode: uses the isSelectable prop from Body.
   */
  const canSelect = (item) => {
    if (mode === 'image') {
      return config.settings.imageObjects.includes(item['@type']);
    }
    return isSelectable(item);
  };

  return (
    <Segment as="ul" className="object-listing">
      {isLoading && !hasItems && (
        <li className="ob-loading-indicator">
          <Loader active inline="centered" size="small">
            {intl.formatMessage(messages.loading)}
          </Loader>
        </li>
      )}
      {currentSearchResults &&
        currentSearchResults.items?.map((item) =>
          view === 'icons' ? (
            <li
              key={item['@id']}
              className="image-wrapper"
              title={`${item['@id']} (${item['@type']})`}
            >
              <div
                basic
                role="presentation"
                onClick={() => handleClickOnItem(item)}
                className="image-preview"
                aria-label={
                  item.is_folderish
                    ? `${intl.formatMessage(messages.browse)} ${item.title}`
                    : `${intl.formatMessage(messages.select)} ${item.title}`
                }
              >
                {item['@type'] === 'Image' ? (
                  <Image
                    src={`${item['@id']}/@@images/image/preview`}
                    alt={item.title}
                    style={{
                      width: 143,
                      height: 143,
                    }}
                    className={isSelected(item) ? 'selected' : ''}
                  />
                ) : (
                  <div className="icon-wrapper">
                    <Icon
                      name={getContentIcon(item['@type'], item.is_folderish)}
                      size="45px"
                    />
                  </div>
                )}
              </div>
              <div className="image-title">
                <div
                  className="icon-align-name"
                  onClick={() => handleClickOnItem(item)}
                  aria-hidden="true"
                >
                  <div
                    title={item.title}
                    style={{ width: 143 }}
                    className="image-title-content"
                  >
                    {item.title}
                  </div>
                </div>
              </div>
            </li>
          ) : (
            <li
              role="presentation"
              aria-label={
                item.is_folderish
                  ? `${intl.formatMessage(messages.browse)} ${item.title}`
                  : `${intl.formatMessage(messages.select)} ${item.title}`
              }
              key={item['@id']}
              className={cx('', {
                'selected-item': isSelected(item),
                disabled:
                  mode === 'image'
                    ? !config.settings.imageObjects.includes(item['@type']) &&
                      !item.is_folderish
                    : !isSelectable(item) && !item.is_folderish,
              })}
              onClick={() => handleClickOnItem(item)}
            >
              {/* Selection control: radio (single) or checkbox (multiple) */}
              {canSelect(item) && handleSelectItem && (
                <span
                  className="ob-select-control"
                  role="presentation"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectItem(item);
                  }}
                >
                  {mode === 'multiple' ? (
                    <input
                      type="checkbox"
                      checked={isSelected(item)}
                      readOnly
                      tabIndex={-1}
                    />
                  ) : (
                    <input
                      type="radio"
                      checked={isSelected(item)}
                      readOnly
                      tabIndex={-1}
                    />
                  )}
                </span>
              )}

              <span title={`${item['@id']} (${item['@type']})`}>
                <Popup
                  key={item['@id']}
                  content={
                    <>
                      <Icon name={homeSVG} size="18px" />{' '}
                      {flattenToAppURL(item['@id'])} ( {item['@type']})
                    </>
                  }
                  trigger={
                    <span>
                      <Icon
                        name={getContentIcon(item['@type'], item.is_folderish)}
                        size="24px"
                      />
                    </span>
                  }
                />

                {item.title}
              </span>

              {/* Chevron for folderish items — visual hint that clicking navigates */}
              {item.is_folderish && (
                <Icon
                  className="right-arrow-icon"
                  name={rightArrowSVG}
                  size="24px"
                />
              )}

            </li>
          ),
        )}
    </Segment>
  );
};

export default ObjectBrowserNav;
