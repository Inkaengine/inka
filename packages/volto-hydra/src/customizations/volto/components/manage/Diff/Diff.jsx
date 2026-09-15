/**
 * Inka's compare view — SHADOWS Volto's Diff component (customizations/).
 *
 * Volto's diff renders both versions with Volto's OWN block components, which
 * a hydra admin deliberately doesn't have: the frontend is the only renderer.
 * So compare the way everything else renders here: TWO frontend iframes side
 * by side, each in `hydra-view:` mode (view markup, no edit chrome), each fed
 * its version's content as FORM_DATA the moment it says INIT — the same
 * push pipeline the editor uses, read-only.
 *
 * Kept from Volto's original: the toolbar portal (back to history) and the
 * Base/Compare version dropdowns, so versions are named and switchable from
 * inside the view. A unified inline text-diff is out of scope by design:
 * there is no honest way to line-diff two arbitrary frontend renders (see
 * volto-hydra#327).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation, useHistory, Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { Dropdown, Table } from 'semantic-ui-react';
import { getContent } from '@plone/volto/actions/content/content';
import { getHistory } from '@plone/volto/actions/history/history';
import { getBaseUrl } from '@plone/volto/helpers/Url/Url';
import FormattedDate from '@plone/volto/components/theme/FormattedDate/FormattedDate';
import Icon from '@plone/volto/components/theme/Icon/Icon';
import Toolbar from '@plone/volto/components/manage/Toolbar/Toolbar';
import { useClient } from '@plone/volto/hooks/client/useClient';
import backSVG from '@plone/volto/icons/back.svg';
import { getURlsFromEnv } from '../../../../../utils/getSavedURLs';
import { getIframeUrlCookieName } from '../../../../../utils/cookieNames';
import { addUrlParams } from '../../../../../utils/iframeUrl';
import ViewPane from '../../../../../components/Iframe/ViewPane';

const panelStyle = {
  flex: '1 1 0',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid #ccc',
  borderRadius: '4px',
  overflow: 'hidden',
};

const VersionPane = ({ label, when, actor, src, content }) => (
  <div style={panelStyle}>
    <div style={{ padding: '0.5em 1em', background: '#f3f5f7', borderBottom: '1px solid #ccc' }}>
      <strong>{label}</strong>
      {when ? (
        <span style={{ marginLeft: '0.75em', color: '#666' }}>
          <FormattedDate date={when} long className="text" />
        </span>
      ) : null}
      {actor ? <span style={{ marginLeft: '0.75em', color: '#666' }}>{actor}</span> : null}
    </div>
    <ViewPane
      title={label}
      src={src}
      content={content}
      style={{ flex: 1, width: '100%', border: 0, minHeight: '70vh' }}
    />
  </div>
);

const HydraDiff = (props) => {
  const dispatch = useDispatch();
  const location = useLocation();
  const routerHistory = useHistory();
  const isClient = useClient();
  const path = getBaseUrl(location.pathname);
  const params = new URLSearchParams(location.search);
  const one = params.get('one') ?? undefined;
  const two = params.get('two') ?? undefined;
  const [versions, setVersions] = useState({});

  const historyEntries = useSelector((state) => state.history?.entries || []);
  useEffect(() => {
    dispatch(getHistory(path));
  }, [dispatch, path]);

  // One option per versioned history entry, newest first — same naming as
  // Volto's own diff: the newest is "Current", the rest by version number.
  const versionOptions = useMemo(
    () =>
      historyEntries
        .filter((entry) => 'version' in entry)
        .map((entry, index) => ({
          text: (
            <>
              {index === 0 ? 'Current' : `Version ${entry.version}`}
              &nbsp;(
              <FormattedDate date={entry.time} long className="text" />
              {entry.actor?.fullname ? <>,&nbsp;{entry.actor.fullname}</> : null})
            </>
          ),
          value: `${entry.version}`,
          key: `${entry.version}`,
        })),
    [historyEntries],
  );
  const versionMeta = (v) =>
    historyEntries.find((entry) => `${entry.version}` === `${v}`);
  const versionLabel = (v) => {
    const newest = historyEntries.find((entry) => 'version' in entry);
    return newest && `${newest.version}` === `${v}` ? 'Current' : `Version ${v}`;
  };

  const urlFromEnv = getURlsFromEnv();
  const cookieMatch =
    typeof document !== 'undefined' &&
    document.cookie.match(new RegExp(`${getIframeUrlCookieName()}=([^;]+)`));
  const previewBase =
    useSelector((state) => state.frontendPreviewUrl?.url) ||
    (cookieMatch ? decodeURIComponent(cookieMatch[1]) : null) ||
    urlFromEnv[0]?.url;
  const token = useSelector((state) => state.userSession?.token);
  // The SAME url recipe the editor's canvas uses — hash-routed frontends get
  // the path in the hash, and the access token rides along so the pane's own
  // SSR fetch is authenticated like the canvas's.
  const src = previewBase
    ? addUrlParams(previewBase, { access_token: token || '', _edit: 'false' }, path)
    : null;

  useEffect(() => {
    let cancelled = false;
    const load = async (version, key) => {
      // getContent(version) hits @history/<version>; dispatch resolves with
      // the response body, which IS the content at that version.
      const data = await dispatch(getContent(path, version, `diff-${key}`));
      if (!cancelled) setVersions((v) => ({ ...v, [key]: data }));
    };
    if (one !== undefined) load(one, 'one');
    if (two !== undefined) load(two, 'two');
    return () => {
      cancelled = true;
    };
  }, [dispatch, path, one, two]);

  const repoint = (nextOne, nextTwo) =>
    routerHistory.push(`${location.pathname}?one=${nextOne}&two=${nextTwo}`);

  return (
    <div id="page-diff" style={{ padding: '1em' }}>
      <h1 style={{ marginBottom: '0.25em' }}>Compare versions</h1>
      <p style={{ color: '#666' }}>
        Two versions of <code>{path}</code>, rendered exactly as visitors see
        them. <Link to={`${path === '/' ? '' : path}/historyview`}>Back to history</Link>
      </p>
      {versionOptions.length > 0 && (
        <Table basic="very">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell width={6}>
                Base
                <Dropdown
                  onChange={(event, { value }) => repoint(value, two)}
                  value={one}
                  selection
                  fluid
                  options={versionOptions}
                />
              </Table.HeaderCell>
              <Table.HeaderCell width={6}>
                Compare
                <Dropdown
                  onChange={(event, { value }) => repoint(one, value)}
                  value={two}
                  selection
                  fluid
                  options={versionOptions}
                />
              </Table.HeaderCell>
            </Table.Row>
          </Table.Header>
        </Table>
      )}
      {!src ? (
        <p>No frontend preview URL configured.</p>
      ) : (
        <div style={{ display: 'flex', gap: '1em', alignItems: 'stretch' }}>
          <VersionPane
            label={versionLabel(one)}
            when={versionMeta(one)?.time || versions.one?.modified}
            actor={versionMeta(one)?.actor?.fullname}
            src={src}
            content={versions.one}
          />
          <VersionPane
            label={versionLabel(two)}
            when={versionMeta(two)?.time || versions.two?.modified}
            actor={versionMeta(two)?.actor?.fullname}
            src={src}
            content={versions.two}
          />
        </div>
      )}
      {isClient &&
        createPortal(
          <Toolbar
            pathname={location.pathname}
            hideDefaultViewButtons
            inner={
              <Link to={`${path === '/' ? '' : path}/historyview`} className="item">
                <Icon name={backSVG} className="contents circled" size="30px" title="Back" />
              </Link>
            }
          />,
          document.getElementById('toolbar'),
        )}
    </div>
  );
};

export default HydraDiff;
