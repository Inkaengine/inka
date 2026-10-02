/**
 * Image Widget - Volto Hydra Shadow
 *
 * VOLTO-HYDRA SHADOW:
 * This file shadows @plone/volto's ImageWidget to:
 * - Use AddLinkForm for consistent UI with the toolbar image popup
 * - Add showPreview option for inline use (without image preview/Message wrapper)
 * - Support drag-and-drop via Dropzone wrapper
 * - Reuse upload logic for both sidebar and inline contexts
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Button, Dimmer, Loader, Message } from 'semantic-ui-react';
import { useIntl, defineMessages } from 'react-intl';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import loadable from '@loadable/component';
import { connect } from 'react-redux';
import { compose } from 'redux';
import { toast } from 'react-toastify';
import withObjectBrowser from '@plone/volto/components/manage/Sidebar/ObjectBrowser';
import config from '@plone/volto/registry';

import {
  flattenToAppURL,
  getBaseUrl,
  getParentUrl,
  isInternalURL,
  normalizeUrl,
  removeProtocol,
  addAppURL,
} from '@plone/volto/helpers/Url/Url';
import { validateFileUploadSize } from '@plone/volto/helpers/FormValidation/FormValidation';
import { usePrevious } from '@plone/volto/helpers/Utils/usePrevious';
import { createContent } from '@plone/volto/actions/content/content';
import { readAsDataURL } from 'promise-file-reader';
import FormFieldWrapper from '@plone/volto/components/manage/Widgets/FormFieldWrapper';
import Icon from '@plone/volto/components/theme/Icon/Icon';
import Toast from '@plone/volto/components/manage/Toast/Toast';
import Image from '@plone/volto/components/theme/Image/Image';
import { urlValidator } from '@plone/volto/helpers/FormValidation/validators';
import { searchContent } from '@plone/volto/actions/search/search';

import imageSVG from '@plone/volto/icons/image.svg';
import clearSVG from '@plone/volto/icons/clear.svg';

// Import AddLinkForm for consistent UI
import AddLinkForm from '../AnchorPlugin/components/LinkButton/AddLinkForm';

const Dropzone = loadable(() => import('react-dropzone'));

/**
 * Does this file match the field's `accept` list?
 *
 * Accepts the same forms the HTML attribute does — a comma-separated list of
 * mime types, each either exact ("image/svg+xml") or a wildcard ("image/*").
 * An empty list accepts anything.
 */
function fileTypeAccepted(file, accept) {
  if (!accept) return true;
  const type = (file?.type || '').toLowerCase();
  return accept
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) =>
      entry.endsWith('/*')
        ? type.startsWith(entry.slice(0, -1))
        : type === entry,
    );
}

export const ImageToolbar = ({ className, data, id, onChange, selected }) => (
  <div className="image-upload-widget-toolbar">
    <Button.Group>
      <Button icon basic onClick={() => onChange(id, null)} aria-label="Clear image">
        <Icon className="circled" name={clearSVG} size="24px" color="#e40166" />
      </Button>
    </Button.Group>
  </div>
);

const messages = defineMessages({
  addImage: {
    id: 'Browse the site, drop an image, or type a URL',
    defaultMessage: 'Browse the site, drop an image, or use a URL',
  },
  uploadingImage: {
    id: 'Uploading image',
    defaultMessage: 'Uploading image',
  },
  Error: {
    id: 'Error',
    defaultMessage: 'Error',
  },
  imageUploadWrongType: {
    id: 'imageUploadWrongType',
    defaultMessage: 'That file type cannot be used here. This field takes {accept}.',
  },
  imageUploadErrorMessage: {
    id: 'imageUploadErrorMessage',
    defaultMessage: 'Please upload an image instead.',
  },
  internalImageNotFoundErrorMessage: {
    id: 'internalImageNotFoundErrorMessage',
    defaultMessage: 'No image was found in the internal path you provided.',
  },
});

const UnconnectedImageInput = (props) => {
  const {
    id,
    onChange,
    onFocus,
    openObjectBrowser,
    value,
    imageSize = 'teaser',
    selected = true,
    restrictFileUpload = false,
    objectBrowserPickerType = 'image',
    description,
    placeholder,
    // HYDRA: which file types this FIELD takes, from its schema. A pictogram
    // field is SVG-only (a raster cannot take its colour from the page), and
    // without this the widget offered every image type and the wrong file
    // failed silently much later, at render.
    accept = 'image/*',
    showPreview = true, // HYDRA: New prop - set to false for inline use
    onClose, // HYDRA: Optional callback when form should close (for inline use)
  } = props;
  const imageValue = value?.[0]?.['@id'] || value?.['@id'] || value;

  const intl = useIntl();
  const location = useLocation();
  const dispatch = useDispatch();
  const isFolderish = useSelector(
    (state) => state?.content?.data?.is_folderish,
  );
  const contextUrl = location.pathname;

  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const requestId = `image-upload-${id}`;

  const loaded = props.request.loaded;
  const { content } = props;
  const imageId = content?.['@id'];
  const image = content?.image;
  let loading = false;
  const isRelationChoice = props.factory === 'Relation Choice';

  // Handle upload completion
  useEffect(() => {
    if (uploading && loading && loaded) {
      setUploading(false);
      if (isRelationChoice) {
        onChange(id, content, {
          image_field: 'image',
          image_scales: { image: [image] },
        });
      } else {
        onChange(id, imageId, {
          image_field: 'image',
          image_scales: { image: [image] },
        });
      }
      // Close form after successful upload (for inline use)
      onClose?.();
    }
  }, [
    loading,
    loaded,
    uploading,
    imageId,
    image,
    id,
    content,
    isRelationChoice,
    onChange,
    onClose,
  ]);

  // Handle upload error
  useEffect(() => {
    if (uploading && props.request?.error) {
      setUploading(false);
      toast.error(
        <Toast
          error
          title={intl.formatMessage(messages.Error)}
          content={
            props.request.error?.message ||
            intl.formatMessage(messages.imageUploadErrorMessage)
          }
        />,
      );
    }
  }, [uploading, props.request?.error, intl]);

  loading = usePrevious(props.request?.loading);

  // File upload handler - reused for both click and drag-drop
  const handleUpload = useCallback(
    (file) => {
      let uploadUrl = getBaseUrl(contextUrl);
      if (!isFolderish) uploadUrl = getParentUrl(uploadUrl);
      if (restrictFileUpload === true) return;

      setUploading(true);
      // `accept` on a dropzone is advisory — it greys files out in the picker
      // and is skipped entirely by a drag. This is the one place both the drop
      // and the file input arrive, so check the actual file here.
      if (!fileTypeAccepted(file, accept)) {
        setUploading(false);
        toast.error(
          <Toast
            error
            title={intl.formatMessage(messages.Error)}
            content={intl.formatMessage(messages.imageUploadWrongType, {
              accept,
            })}
          />,
        );
        return;
      }
      if (!validateFileUploadSize(file, intl.formatMessage)) {
        setUploading(false);
        return;
      }
      readAsDataURL(file).then((fileData) => {
        const fields = fileData.match(/^data:(.*);(.*),(.*)$/);
        if (!fields) {
          console.error('[ImageWidget] Invalid file data format:', fileData?.substring(0, 100));
          setUploading(false);
          toast.error(
            <Toast
              error
              title={intl.formatMessage(messages.Error)}
              content={intl.formatMessage(messages.imageUploadErrorMessage)}
            />,
          );
          return;
        }
        dispatch(
          createContent(
            uploadUrl,
            {
              '@type': 'Image',
              title: file.name,
              image: {
                data: fields[3],
                encoding: fields[2],
                'content-type': fields[1],
                filename: file.name,
              },
            },
            props.block || requestId,
          ),
        );
      });
    },
    [
      contextUrl,
      isFolderish,
      restrictFileUpload,
      intl.formatMessage,
      dispatch,
      props.block,
      requestId,
    ],
  );

  // Handle dropzone file drop
  const handleDrop = useCallback(
    (acceptedFiles) => {
      setDragging(false);
      if (acceptedFiles.length > 0) {
        handleUpload(acceptedFiles[0]);
      } else {
        toast.error(
          <Toast
            error
            title={intl.formatMessage(messages.Error)}
            content={intl.formatMessage(messages.imageUploadErrorMessage)}
          />,
        );
      }
    },
    [handleUpload, intl],
  );

  const onDragEnter = useCallback(() => {
    if (restrictFileUpload === false) setDragging(true);
  }, [restrictFileUpload]);
  const onDragLeave = useCallback(() => setDragging(false), []);

  // Handle URL submission from AddLinkForm
  const handleUrlChange = useCallback(
    (url) => {
      const flatUrl = isInternalURL(url) ? flattenToAppURL(url) : url;

      if (isInternalURL(flatUrl)) {
        // Search for internal image to get metadata
        props
          .searchContent(
            '/',
            {
              portal_type: config.settings.imageObjects,
              'path.query': flatUrl,
              'path.depth': '0',
              sort_on: 'getObjPositionInParent',
              metadata_fields: '_all',
              b_size: 1000,
            },
            `${props.block}-${props.mode}`,
          )
          .then((resp) => {
            if (resp.items?.length > 0) {
              const item = resp.items[0];
              onChange(id, flatUrl, {
                title: item.title,
                image_field: item.image_field || 'image',
                image_scales: item.image_scales,
              });
              onClose?.();
            } else {
              toast.error(
                <Toast
                  error
                  title={intl.formatMessage(messages.Error)}
                  content={intl.formatMessage(
                    messages.internalImageNotFoundErrorMessage,
                  )}
                />,
              );
            }
          });
      } else {
        // External URL
        if (isRelationChoice) {
          toast.error(
            <Toast
              error
              title={intl.formatMessage(messages.Error)}
              content={intl.formatMessage(messages.imageUploadErrorMessage)}
            />,
          );
        } else {
          onChange(id, [
            {
              '@id': normalizeUrl(url),
              title: removeProtocol(url),
            },
          ]);
          onClose?.();
        }
      }
    },
    [props, id, onChange, isRelationChoice, intl, onClose],
  );

  // Handle direct selection from object browser (with full item metadata)
  // NOTE: This hook MUST be before any conditional returns to satisfy React's rules of hooks
  const handleSelectItem = useCallback(
    (url, item) => {
      const flatUrl = flattenToAppURL(url);
      // Use metadata directly from object browser item (no search needed)
      onChange(id, flatUrl, {
        title: item?.title,
        image_field: item?.image_field || 'image',
        image_scales: item?.image_scales,
      });
      onClose?.();
    },
    [id, onChange, onClose],
  );

  // When image exists - show preview (if showPreview is true)
  if (imageValue) {
    if (!showPreview) {
      // For inline use, just render nothing when image exists
      // (the actual image is rendered by the frontend)
      return null;
    }
    return (
      <div
        className="image-upload-widget-image"
        onClick={onFocus}
        onKeyDown={onFocus}
        role="toolbar"
      >
        {selected && <ImageToolbar {...props} />}
        {isRelationChoice ? (
          <Image
            item={value}
            width="fit-content"
            height="auto"
            loading="lazy"
            sizes="320px"
          />
        ) : (
          <Image
            className={props.className}
            src={
              isInternalURL(imageValue)
                ? `${flattenToAppURL(imageValue)}/@@images/image/${imageSize}`
                : imageValue
            }
            alt=""
          />
        )}
      </div>
    );
  }

  // No image - show picker UI
  const pickerContent = (
    <AddLinkForm
      // Mounted because a block was selected, not because the author asked for
      // this form — so it must not steal the caret from the preview iframe.
      autoFocus={false}
      data={{ url: '' }}
      theme={{}}
      objectBrowserPickerType="image"
      placeholder={placeholder || description || intl.formatMessage(messages.addImage)}
      onChangeValue={handleUrlChange}
      onSelectItem={handleSelectItem}
      onClear={() => {}}
      onOverrideContent={() => onClose?.()}
      openObjectBrowser={openObjectBrowser}
      isObjectBrowserOpen={props.isObjectBrowserOpen}
      onFileUpload={restrictFileUpload ? undefined : handleUpload}
    />
  );

  // For inline use (showPreview=false), just return AddLinkForm with dropzone
  if (!showPreview) {
    return (
      <Dropzone
        noClick
        accept={accept}
        onDrop={handleDrop}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
      >
        {({ getRootProps, getInputProps }) => (
          <div
            {...getRootProps()}
            className="hydra-image-picker-inline"
            style={{
              // Don't use position:absolute - parent overlay already positions via flexbox
              // This allows clicks to pass through empty areas of the overlay
              pointerEvents: 'auto', // Capture events only on form content
            }}
          >
            <input {...getInputProps()} />
            {dragging && <div className="dropzone-dragging-overlay" />}
            {uploading && (
              <Dimmer active>
                <Loader indeterminate>
                  {intl.formatMessage(messages.uploadingImage)}
                </Loader>
              </Dimmer>
            )}
            {pickerContent}
          </div>
        )}
      </Dropzone>
    );
  }

  // Sidebar use - matching the inline overlay style
  return (
    <div
      className="image-upload-widget"
      onClick={onFocus}
      onKeyDown={onFocus}
      role="toolbar"
    >
      <Dropzone
        noClick
        accept="image/*"
        onDrop={handleDrop}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        className="dropzone"
      >
        {({ getRootProps, getInputProps }) => (
          <div {...getRootProps()}>
            <input {...getInputProps()} />
            <Message>
              {dragging && <Dimmer active />}
              {uploading && (
                <Dimmer active>
                  <Loader indeterminate>
                    {intl.formatMessage(messages.uploadingImage)}
                  </Loader>
                </Dimmer>
              )}
              {/* Circular icon matching inline overlay */}
              <div
                style={{
                  width: '80px',
                  height: '80px',
                  borderRadius: '50%',
                  background: 'rgba(0, 123, 255, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 12px',
                }}
              >
                <Icon name={imageSVG} size="40px" color="#007bff" />
              </div>
              {/* "Add your Image" text */}
              <p style={{ color: '#333', fontSize: '14px', fontWeight: 500, marginBottom: '16px', textAlign: 'center' }}>
                {placeholder || description || intl.formatMessage(messages.addImage)}
              </p>
              {/* Action row with AddLinkForm */}
              <div className="toolbar-wrapper" style={{ display: 'flex', justifyContent: 'center' }}>
                <div className="toolbar-inner">
                  {pickerContent}
                </div>
              </div>
            </Message>
          </div>
        )}
      </Dropzone>
    </div>
  );
};

export const ImageInput = compose(
  withObjectBrowser,
  connect(
    (state, ownProps) => {
      const requestId = `image-upload-${ownProps.id}`;
      return {
        request: state.content.subrequests[ownProps.block || requestId] || {},
        content: state.content.subrequests[ownProps.block || requestId]?.data,
      };
    },
    { createContent, searchContent },
  ),
)(UnconnectedImageInput);

const ImageUploadWidget = (props) => {
  const { fieldSet, id, title } = props;
  return (
    <FormFieldWrapper
      {...props}
      columns={1}
      className="block image-upload-widget"
    >
      <div className="wrapper">
        <label
          id={`fieldset-${fieldSet}-field-label-${id}`}
          htmlFor={`field-${id}`}
        >
          {title}
        </label>
      </div>
      <ImageInput {...props} />
    </FormFieldWrapper>
  );
};

export default ImageUploadWidget;
