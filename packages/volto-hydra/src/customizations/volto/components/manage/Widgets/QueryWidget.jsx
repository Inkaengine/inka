/**
 * QuerystringWidget component.
 * @module components/manage/Widgets/QuerystringWidget
 */

import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { compose } from 'redux';
import { connect } from 'react-redux';
import { Button, Checkbox, Form, Grid, Input, Label } from 'semantic-ui-react';
import filter from 'lodash/filter';
import remove from 'lodash/remove';
import toPairs from 'lodash/toPairs';
import groupBy from 'lodash/groupBy';
import isEmpty from 'lodash/isEmpty';
import map from 'lodash/map';
import { defineMessages, injectIntl } from 'react-intl';
import { withRouter } from 'react-router';
import { getQuerystring } from '@plone/volto/actions/querystring/querystring';
import { getQueryStringResults } from '@plone/volto/actions/querystringsearch/querystringsearch';
import { withThisPageOperation } from '@volto-hydra/helpers';
import Icon from '@plone/volto/components/theme/Icon/Icon';
import ObjectBrowserWidget from '@plone/volto/components/manage/Widgets/ObjectBrowserWidget';
import NumberWidget from '@plone/volto/components/manage/Widgets/NumberWidget';
import { injectLazyLibs } from '@plone/volto/helpers/Loadable/Loadable';
import cx from 'classnames';
import config from '@plone/volto/registry';

import {
  Option,
  DropdownIndicator,
  selectTheme,
  customSelectStyles,
} from '@plone/volto/components/manage/Widgets/SelectStyling';

import clearSVG from '@plone/volto/icons/clear.svg';
import { parseLocation, formatLocation } from '../../../../../utils/location';

const messages = defineMessages({
  Criteria: {
    id: 'Criteria',
    defaultMessage: 'Criteria',
  },
  AddCriteria: {
    id: 'Add criteria',
    defaultMessage: 'Add criteria',
  },
  select: {
    id: 'querystring-widget-select',
    defaultMessage: 'Select…',
  },
  // Inka: the Relative path places, counted as editors count the levels of
  // the site (the site root is the 1st).
  level2: { id: 'query-widget-level2', defaultMessage: '2nd level' },
  level3: { id: 'query-widget-level3', defaultMessage: '3rd level' },
  level4: { id: 'query-widget-level4', defaultMessage: '4th level' },
  parent: { id: 'query-widget-parent', defaultMessage: 'Parent' },
  here: { id: 'query-widget-here', defaultMessage: 'Here' },
  childrenOnly: {
    id: 'query-widget-childrenOnly',
    defaultMessage: 'Children only',
  },
  // Inka: a relative path's depth, as the absolute path has one.
  relativeDepthDescription: {
    id: 'query-widget-relativeDepthDescription',
    defaultMessage: 'Levels below it to list. Empty lists every level.',
  },
});

/**
 * Widget for a querystring value, to define a catalog search criteria.
 */
export class QuerystringWidgetComponent extends Component {
  /**
   * Property types.
   * @property {Object} propTypes Property types.
   * @static
   */
  static propTypes = {
    id: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    description: PropTypes.string,
    required: PropTypes.bool,
    error: PropTypes.arrayOf(PropTypes.string),
    value: PropTypes.array,
    focus: PropTypes.bool,
    onChange: PropTypes.func,
    onEdit: PropTypes.func,
    onDelete: PropTypes.func,
    getQuerystring: PropTypes.func.isRequired,
  };

  /**
   * Default properties.
   * @property {Object} defaultProps Default properties.
   * @static
   */
  static defaultProps = {
    description: null,
    required: false,
    error: [],
    value: null,
    onChange: null,
    onEdit: null,
    onDelete: null,
    focus: false,
  };

  /**
   * Constructor
   * @method constructor
   * @param {Object} props Component properties
   * @constructs EditComponent
   */
  constructor(props) {
    super(props);
    this.state = {
      visual: false,
    };
    this.onChangeValue = this.onChangeValue.bind(this);
    this.getWidget = this.getWidget.bind(this);
    this.loadReferenceWidgetItem = this.loadReferenceWidgetItem.bind(this);
  }

  /**
   * Component did mount lifecycle method
   * @method componentDidMount
   * @returns {undefined}
   */
  componentDidMount() {
    if (this.props.focus) {
      this.node.focus();
    }
    this.props.getQuerystring();
  }

  loadReferenceWidgetItem(v) {
    const loading =
      this.props.reference[`${v}_query_reference`]?.loading ?? false;
    if (!loading && v?.length > 0) {
      this.props.getQueryStringResults(
        '/',
        {
          b_size: 1,
          query: [
            {
              i: 'path',
              o: 'plone.app.querystring.operation.string.absolutePath',
              v: v + '::0',
            },
          ],
        },
        v + '_query_reference',
      );
    }
  }

  /**
   * Get correct widget
   * @method getWidget
   * @param {Object} row Row object.
   * @param {number} index Row index.
   * @returns {Object} Widget.
   */
  getWidget(row, index, Select, intl) {
    const props = {
      fluid: true,
      value: row.v,
      onChange: (data) => this.onChangeValue(index, data.target.value),
    };
    const values = this.props.indexes[row.i].values;
    const operator = this.props.indexes[row.i].operators[row.o];

    switch (operator.widget) {
      case null:
        return <span />;
      case 'DateWidget':
        return (
          <Form.Field style={{ flex: '1 0 auto' }}>
            <Input type="date" {...props} value={row.v} />
          </Form.Field>
        );
      case 'DateRangeWidget': // 2 date inputs
        return (
          <React.Fragment>
            <Form.Field style={{ flex: '1 0 auto' }}>
              <Input
                type="date"
                {...props}
                value={row.v[0]}
                onChange={(data) =>
                  this.onChangeValue(index, [data.target.value, row.v[1]])
                }
              />
            </Form.Field>
            <Form.Field style={{ flex: '1 0 auto' }}>
              <Input
                type="date"
                {...props}
                value={row.v[1]}
                onChange={(data) =>
                  this.onChangeValue(index, [row.v[0], data.target.value])
                }
              />
            </Form.Field>
          </React.Fragment>
        );
      case 'RelativeDateWidget':
        return (
          <Form.Field style={{ flex: '1 0 auto' }}>
            <Input step={1} type="number" {...props} />
          </Form.Field>
        );
      case 'MultipleSelectionWidget':
        return (
          <Form.Field style={{ flex: '1 0 auto', maxWidth: '92%' }}>
            <Select
              {...props}
              className="react-select-container"
              classNamePrefix="react-select"
              options={
                values
                  ? map(toPairs(values), (value) => ({
                      label: value[1].title,
                      value: value[0],
                    }))
                  : []
              }
              styles={customSelectStyles}
              placeholder={this.props.intl.formatMessage(messages.select)}
              theme={selectTheme}
              components={{ DropdownIndicator, Option }}
              onChange={(data) => {
                this.onChangeValue(
                  index,
                  map(data, (item) => item.value),
                );
              }}
              isMulti={true}
              value={map(row.v, (value) => ({
                label: values?.[value]?.title || value,
                value,
              }))}
            />
          </Form.Field>
        );
      case 'autocomplete':
        const AutoCompleteComponent = config.widgets.widget.autocomplete;
        const vocabulary = { '@id': this.props.indexes[row.i].vocabulary };
        return (
          <Form.Field style={{ flex: '1 0 auto', maxWidth: '92%' }}>
            <AutoCompleteComponent
              {...props}
              vocabulary={vocabulary}
              wrapped={false}
              id={`id-${index}`}
              title={`title-${index}`}
              onChange={(_d, data) => {
                this.onChangeValue(index, data);
              }}
            />
          </Form.Field>
        );
      case 'ReferenceWidget': {
        // Inka: the folder picked is stored by its UID, with the ending that
        // says whether it is listed too (`uid/`) or only what is under it
        // (`uid/*`); see utils/location.
        const location = parseLocation(props.value);
        const uidValue = location.base;
        if (uidValue && !this.props.reference[`${uidValue}_query_reference`]) {
          this.loadReferenceWidgetItem(uidValue);
        }
        const referenceItem = this.props.reference[
          `${uidValue}_query_reference`
        ]
          ? this.props.reference[`${uidValue}_query_reference`].items[0]
          : null;
        return (
          <div className="location-object-browser">
            <Form.Field className="object-browser-field">
              <ObjectBrowserWidget
                id={`query-reference-widget-${index}`}
                mode="link"
                onChange={(id, data) => {
                  const itemSelected = data.length > 0 ? data[0] : {};
                  const uid = itemSelected.UID ?? '';
                  // A first pick is Volto's: the folder's children, depth 1.
                  this.onChangeValue(
                    index,
                    formatLocation(
                      location.base
                        ? { ...location, base: uid }
                        : { base: uid, childrenOnly: true, depth: 1 },
                    ),
                  );
                  this.loadReferenceWidgetItem(uid);
                }}
                value={uidValue && this.props.reference ? [referenceItem] : []}
                wrapped={false}
                onlyFolderishSelectable={true}
                allowExternals={true}
              />
            </Form.Field>

            {uidValue && (
              <Form.Field className="reference-widget-depth">
                <NumberWidget
                  title={intl.formatMessage({
                    id: 'Depth',
                    defaultMessage: 'Depth',
                  })}
                  min={1}
                  step={1}
                  value={location.depth ?? ''}
                  onChange={(id, value) => {
                    const depth = parseInt(value, 10) || 1;
                    this.onChangeValue(
                      index,
                      formatLocation({ ...location, depth }),
                    );
                  }}
                />
              </Form.Field>
            )}
            {uidValue && this.renderChildrenOnly(index, location)}
          </div>
        );
      }
      case 'RelativePathWidget': {
        // Inka: a place counted from the page -- here, its parent, or the
        // section it is in at the 2nd, 3rd or 4th level of the site -- with a
        // depth beside it, as the absolute path has one, and whether the place
        // itself is listed. A place the menu does not offer is shown as it is.
        const location = parseLocation(props.value);
        const relativePathOptions = [
          { label: intl.formatMessage(messages.level2), value: '/*' },
          { label: intl.formatMessage(messages.level3), value: '/*/*' },
          { label: intl.formatMessage(messages.level4), value: '/*/*/*' },
          { label: intl.formatMessage(messages.parent), value: '..' },
          { label: intl.formatMessage(messages.here), value: '.' },
        ];
        if (
          location.base &&
          !relativePathOptions.some((p) => p.value === location.base)
        ) {
          relativePathOptions.push({
            label: location.base,
            value: location.base,
          });
        }
        return (
          <div className="location-object-browser">
            <Form.Field style={{ flex: '1 0 auto', maxWidth: '92%' }}>
              <Select
                {...props}
                className="react-select-container"
                classNamePrefix="react-select"
                options={relativePathOptions}
                styles={customSelectStyles}
                placeholder={this.props.intl.formatMessage(messages.select)}
                theme={selectTheme}
                components={{ DropdownIndicator, Option }}
                onChange={(data) => {
                  this.onChangeValue(
                    index,
                    formatLocation({ ...location, base: data.value }),
                  );
                }}
                isMulti={false}
                value={relativePathOptions.find(
                  (p) => p.value === location.base,
                )}
              />
            </Form.Field>
            {location.base && (
              <Form.Field className="reference-widget-depth">
                <NumberWidget
                  id={`query-relative-depth-${index}`}
                  title={intl.formatMessage({
                    id: 'Depth',
                    defaultMessage: 'Depth',
                  })}
                  description={intl.formatMessage(
                    messages.relativeDepthDescription,
                  )}
                  min={0}
                  step={1}
                  value={location.depth ?? ''}
                  onChange={(id, value) => {
                    const depth = parseInt(value, 10);
                    const next = Number.isNaN(depth) ? null : depth;
                    this.onChangeValue(
                      index,
                      formatLocation({
                        ...location,
                        depth: next,
                        // Depth 0 is the place alone: nothing is under it.
                        childrenOnly:
                          next === 0 ? false : location.childrenOnly,
                      }),
                    );
                  }}
                />
              </Form.Field>
            )}
            {location.base && this.renderChildrenOnly(index, location)}
          </div>
        );
      }
      default:
        // if (row.o === 'plone.app.querystring.operation.string.relativePath') {
        //   props.onChange = data => this.onChangeValue(index, data.target.value);
        // }
        return (
          <Form.Field style={{ flex: '1 0 auto' }}>
            <Input {...props} description={operator.description} />
          </Form.Field>
        );
    }
  }

  /**
   * Inka: whether a location lists only what is under its place (`/*`) or the
   * place too (`/`). At depth 0 the place is all there is, so it isn't offered.
   * @method renderChildrenOnly
   * @param {Number} index Index of the row.
   * @param {Object} location The row's value, parsed (utils/location).
   * @returns {Object|null} The checkbox.
   */
  renderChildrenOnly(index, location) {
    if (location.depth === 0) return null;
    return (
      <Form.Field className="location-children-only">
        <Checkbox
          id={`query-children-only-${index}`}
          label={this.props.intl.formatMessage(messages.childrenOnly)}
          checked={location.childrenOnly}
          onChange={(e, { checked }) =>
            this.onChangeValue(
              index,
              formatLocation({ ...location, childrenOnly: checked }),
            )
          }
        />
      </Form.Field>
    );
  }

  /**
   * Change value handler
   * @method onChangeValue
   * @param {Number} index Index of the row.
   * @param {String|Array} value Value of the row.
   * @returns {undefined}
   */
  onChangeValue(index, value) {
    this.props.onChange(
      this.props.id,
      map(this.props.value, (row, i) =>
        index === i
          ? {
              ...row,
              v: value,
            }
          : row,
      ),
    );
  }

  /**
   * Render method.
   * @method render
   * @returns {string} Markup for the component.
   */
  render() {
    const {
      id,
      required,
      description,
      error,
      value,
      onChange,
      onEdit,
      indexes,
      fieldSet,
      reactSelect,
      intl,
    } = this.props;

    const Select = reactSelect.default;

    return (
      <Form.Field
        inline
        required={required}
        error={error.length > 0}
        className={cx('query-widget', description ? 'help' : '')}
        id={`${fieldSet || 'field'}-${id}`}
      >
        <Grid>
          <Grid.Row stretched>
            <Grid.Column width="12">
              <div className="simple-field-name">
                {intl.formatMessage(messages.Criteria)}
              </div>
            </Grid.Column>
          </Grid.Row>
          <Grid.Row stretched>
            <Grid.Column width="12">
              {indexes &&
                !isEmpty(indexes) &&
                map(value, (row, index) => (
                  <Form.Group key={index}>
                    <div className="main-fields-wrapper">
                      <Form.Field
                        style={{ flex: '1 0 auto', marginRight: '10px' }}
                      >
                        <Select
                          id={`field-${id}`}
                          name={id}
                          disabled={onEdit !== null}
                          className="react-select-container"
                          classNamePrefix="react-select"
                          options={map(
                            toPairs(
                              groupBy(
                                toPairs(indexes),
                                (item) => item[1].group,
                              ),
                            ),
                            (group) => ({
                              label: group[0],
                              options: map(
                                filter(group[1], (item) => item[1].enabled),
                                (field) => ({
                                  label: field[1].title,
                                  value: field[0],
                                  isDisabled: (value || []).some(
                                    (v) =>
                                      v['i'] !== 'path' && v['i'] === field[0],
                                  ),
                                }),
                              ),
                            }),
                          )}
                          styles={customSelectStyles}
                          theme={selectTheme}
                          placeholder={intl.formatMessage(messages.select)}
                          components={{ DropdownIndicator, Option }}
                          value={{
                            value: row.i,
                            label: indexes[row.i]?.title,
                          }}
                          onChange={(data) => {
                            onChange(
                              id,
                              map(value, (curRow, curIndex) =>
                                curIndex === index
                                  ? {
                                      i: data.value,
                                      o: indexes[data.value].operations[0],
                                      v: '',
                                    }
                                  : curRow,
                              ),
                            );
                          }}
                        />
                      </Form.Field>
                      <Form.Field style={{ flex: '1 0 auto' }}>
                        <Select
                          id={`field-${id}`}
                          name={id}
                          disabled={onEdit !== null}
                          className="react-select-container"
                          classNamePrefix="react-select"
                          options={map(
                            indexes[row.i]?.operations ?? [],
                            (operation) => ({
                              value: operation,
                              label: indexes[row.i].operators[operation].title,
                            }),
                          )}
                          styles={customSelectStyles}
                          theme={selectTheme}
                          placeholder={intl.formatMessage(messages.select)}
                          components={{ DropdownIndicator, Option }}
                          value={{
                            value: row.o,
                            label: indexes[row.i].operators[row.o].title,
                          }}
                          onChange={(data) =>
                            onChange(
                              id,
                              map(value, (curRow, curIndex) =>
                                curIndex === index
                                  ? {
                                      i: row.i,
                                      o: data.value,
                                      v: '',
                                    }
                                  : curRow,
                              ),
                            )
                          }
                        />
                      </Form.Field>
                      {!this.props.indexes[row.i].operators[row.o].widget && (
                        <Button
                          onClick={(event) => {
                            onChange(
                              id,
                              remove(value, (v, i) => i !== index),
                            );
                            event.preventDefault();
                          }}
                          style={{
                            background: 'none',
                            paddingRight: 0,
                            paddingLeft: 0,
                            margin: 0,
                          }}
                        >
                          <Icon name={clearSVG} size="24px" className="close" />
                        </Button>
                      )}
                    </div>
                    {this.getWidget(row, index, Select, intl)}
                    {this.props.indexes[row.i].operators[row.o].widget && (
                      <Button
                        onClick={(event) => {
                          onChange(
                            id,
                            remove(value, (v, i) => i !== index),
                          );
                          event.preventDefault();
                        }}
                        style={{
                          background: 'none',
                          paddingRight: 0,
                          paddingLeft: 0,
                          margin: 0,
                        }}
                      >
                        <Icon name={clearSVG} size="24px" className="close" />
                      </Button>
                    )}
                  </Form.Group>
                ))}
              <Form.Group>
                <Form.Field style={{ flex: '1 0 auto' }}>
                  <Select
                    id={`field-${id}`}
                    name={id}
                    disabled={onEdit !== null}
                    className="react-select-container"
                    classNamePrefix="react-select"
                    placeholder={intl.formatMessage(messages.AddCriteria)}
                    options={map(
                      toPairs(
                        groupBy(toPairs(indexes), (item) => item[1].group),
                      ),
                      (group) => ({
                        label: group[0],
                        options: map(
                          filter(group[1], (item) => item[1].enabled),
                          (field) => ({
                            label: field[1].title,
                            value: field[0],
                            // disable selecting indexes that are already used,
                            // except for path, which has explicit support
                            // in the backend for multipath queries
                            isDisabled: (value || []).some(
                              (v) => v['i'] !== 'path' && v['i'] === field[0],
                            ),
                          }),
                        ),
                      }),
                    )}
                    styles={customSelectStyles}
                    theme={selectTheme}
                    components={{ DropdownIndicator, Option }}
                    value={null}
                    onChange={(data) => {
                      onChange(id, [
                        ...(value || []),
                        {
                          i: data.value,
                          o: indexes[data.value].operations[0],
                          v: '',
                        },
                      ]);
                    }}
                  />
                </Form.Field>
              </Form.Group>
              {map(error, (message) => (
                <Label key={message} basic color="red" pointing>
                  {message}
                </Label>
              ))}
            </Grid.Column>
          </Grid.Row>
          {description && (
            <Grid.Row stretched>
              <Grid.Column stretched width="12">
                <p className="help">{description}</p>
              </Grid.Column>
            </Grid.Row>
          )}
        </Grid>
      </Form.Field>
    );
  }
}

// "Is the same as this page" (@volto-hydra/helpers THIS_PAGE): offered beside
// Plone's own operations on the indexes a page has a value for. Kept for the
// indexes object it was made from, so the widget's props stay the same object
// while Plone's do.
let thisPageFor = null;
let withThisPage = null;
const offeringThisPage = (indexes) => {
  if (indexes !== thisPageFor) {
    thisPageFor = indexes;
    withThisPage = withThisPageOperation(indexes);
  }
  return withThisPage;
};

export default compose(
  injectIntl,
  injectLazyLibs(['reactSelect']),
  withRouter,
  connect(
    (state, props) => ({
      indexes: offeringThisPage(state.querystring.indexes),
      reference: state.querystringsearch.subrequests,
    }),
    { getQuerystring, getQueryStringResults },
  ),
)(QuerystringWidgetComponent);
