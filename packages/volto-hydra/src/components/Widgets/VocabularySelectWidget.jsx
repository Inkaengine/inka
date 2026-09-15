/**
 * VocabularySelectWidget — a select whose choices are the SITE'S VOCABULARIES.
 *
 * Volto has widgets for picking a term FROM a vocabulary; it has none for
 * picking WHICH vocabulary, because nothing in Plone lists vocabularies as a
 * vocabulary. `GET /@vocabularies` does list them — every registered
 * `IVocabularyFactory` — but it answers `{"@id", "title"}` per item, and Volto's
 * vocabulary reducer reads `{token, title}`, so the built-in select stores
 * `undefined` when pointed at it. This widget reads that listing directly and
 * keeps the NAME (the last segment of `@id`), which is what a field referencing
 * a vocabulary holds.
 *
 * Field options (alongside `widget: 'vocabularySelect'`):
 *   - vocabularyFilter: a regular expression, as a string. Only vocabularies
 *       whose name matches are offered — e.g. `'Keywords|Subject'` for a field
 *       that only makes sense with content tags. Omitted → all of them.
 *
 * Why a name and not a URL: the name is stable across environments, and every
 * consumer (`@vocabularies/<name>`, Volto's `getVocabulary`) accepts it. A URL
 * would bake this site's origin into content.
 *
 * Only vocabularies are offered — not catalog queries, and not field-bound
 * sources. A source has no name to store (it is identified by a field on an
 * object) and `@sources` requires the `plone.restapi.vocabularies` permission,
 * so an anonymous visitor could never read one; a catalog query is a query, not
 * a list of terms, and belongs to the search block's criteria instead.
 */
import React, { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useSelector } from 'react-redux';
import config from '@plone/volto/registry';

const messages = defineMessages({
  none: {
    id: 'no vocabulary',
    defaultMessage: '— none —',
  },
});

/** The vocabulary NAME from a listing item's `@id`. */
export function vocabularyNameFrom(item) {
  const id = item?.['@id'] || '';
  const name = id.split('/@vocabularies/')[1] || item?.title || '';
  return decodeURIComponent(name);
}

const VocabularySelectWidget = (props) => {
  const { vocabularyFilter, emptyLabel } = props;
  const intl = useIntl();
  // The token, the way Volto sends it — an Authorization header, not a cookie.
  // `credentials: 'include'` is refused outright by a browser when the API
  // answers `Access-Control-Allow-Origin: *`, which is how the admin and the
  // API being different origins turned into an empty menu and a CORS error in
  // the console rather than anything the widget could see.
  const token = useSelector((state) => state.userSession?.token);
  const [names, setNames] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const apiPath = config.settings?.apiPath || '';
    fetch(`${apiPath}/@vocabularies`, {
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((body) => {
        if (cancelled) return;
        const items = Array.isArray(body) ? body : body?.items || [];
        setNames(items.map(vocabularyNameFrom).filter(Boolean).sort());
      })
      .catch(() => {
        // A site that will not list its vocabularies leaves an empty menu
        // rather than a broken sidebar; the field keeps whatever it holds.
        if (!cancelled) setNames([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const pattern = vocabularyFilter ? new RegExp(vocabularyFilter) : null;
  const choices = [
    // A schema-supplied `emptyLabel` is the author's own wording and is used as
    // written; only our default is translated.
    ['', emptyLabel || intl.formatMessage(messages.none)],
    ...names
      .filter((name) => !pattern || pattern.test(name))
      .map((name) => [name, name]),
  ];

  const SelectWidget = config.widgets.widget.select;
  return <SelectWidget {...props} choices={choices} />;
};

export default VocabularySelectWidget;
