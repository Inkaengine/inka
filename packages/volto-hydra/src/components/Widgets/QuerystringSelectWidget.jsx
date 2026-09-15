/**
 * QuerystringSelectWidget — choices are the SITE'S CATALOG INDEXES, as
 * `@querystring` reports them.
 *
 * Volto has `query_sort_on` for the SINGLE-index case, and hydra passes it
 * through like any registered widget — use that when a field names one index to
 * sort by. It comes with a catch worth knowing: it reads
 * `state.querystring.sortable_indexes` but never dispatches `getQuerystring()`,
 * so it only fills up when something else in the sidebar has already asked
 * (in Volto's listing that is the `QueryWidget` beside it). Alone in a hydra
 * schema it renders an empty menu. This widget asks for itself.
 *
 * What Volto has no declarative answer for is a chosen SUBSET of indexes — the
 * "sort by" menu a search block offers its visitors. Volto builds that
 * imperatively: `SearchBlockEdit` writes `sortOnOptions.items.choices` from
 * `sortable_indexes` before rendering. A hydra frontend has no Edit component —
 * its schema is JSON sent over the bridge — so that route is closed, and the
 * field falls back to a free-text list where an author types index names from
 * memory. A typo there produces a sort option that silently does nothing.
 *
 * Field options (alongside `widget: 'querystringSelect'`):
 *   - indexes: 'sortable' (default) offers only indexes the catalog can sort on;
 *       'all' offers every queryable index.
 *   - multiple: true stores an array — a chosen SUBSET, in the author's order,
 *       which is what a "sort by" menu is. false (the default) stores one name.
 *   - emptyLabel: wording of the "none" entry in single mode (default
 *       "— no sorting —"). Ignored when multiple, where empty says it already.
 *
 * The stored value is the index NAME (`effective`, `sortable_title`), because
 * that is what a query is built from; the title is only what the author reads.
 */
import React, { useEffect } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useDispatch, useSelector } from 'react-redux';
import { getQuerystring } from '@plone/volto/actions';
import config from '@plone/volto/registry';

const messages = defineMessages({
  noSorting: {
    id: 'no sorting',
    defaultMessage: '— no sorting —',
  },
});

/**
 * `[name, title]` pairs for the menu.
 *
 * `sortable_indexes` is already the sortable subset, so asking for 'sortable'
 * uses it directly rather than filtering `indexes` on a flag that means
 * something subtly different.
 */
export function indexChoices(querystring, which, emptyLabel) {
  const source =
    which === 'all' ? querystring?.indexes : querystring?.sortable_indexes;
  const choices = Object.entries(source || {})
    .map(([name, index]) => [name, index?.title || name])
    .sort((a, b) => a[1].localeCompare(b[1]));
  // Picking ONE index needs a way to pick none — for a sort field that is
  // "whatever order the catalog returns", a real answer and usually the
  // default. A multiple field says the same thing by being empty, so it needs
  // no such entry.
  return emptyLabel ? [['', emptyLabel], ...choices] : choices;
}

const QuerystringSelectWidget = (props) => {
  const { indexes = 'sortable', multiple = false, emptyLabel } = props;
  const intl = useIntl();
  const dispatch = useDispatch();
  const querystring = useSelector((state) => state.querystring);

  useEffect(() => {
    // Volto loads this once for the whole editor; ask only if nobody has.
    if (
      !Object.keys(querystring?.indexes || {}).length &&
      !querystring?.loading
    ) {
      dispatch(getQuerystring());
    }
  }, [dispatch, querystring]);

  const choices = indexChoices(
    querystring,
    indexes,
    // A schema-supplied `emptyLabel` is the author's own wording and is used as
    // written; only our default is translated.
    multiple ? null : emptyLabel || intl.formatMessage(messages.noSorting),
  );
  const Widget = multiple
    ? config.widgets.widget.array
    : config.widgets.widget.select;
  return <Widget {...props} choices={choices} />;
};

export default QuerystringSelectWidget;
