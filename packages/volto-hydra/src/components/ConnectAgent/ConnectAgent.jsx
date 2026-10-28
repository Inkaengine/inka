/**
 * /connect-agent?redirect_uri=…&state=…[&client=…] — a person signed in to
 * the admin allows an agent (the Inka MCP server, for an MCP client) to act
 * as them.
 *
 * On Allow, their token is posted, with the agent's `state`, to the agent;
 * on Cancel, only `error=access_denied` and the state. The agent must be on
 * this computer (a local server's loopback listener) or be this site's own
 * MCP server (RAZZLE_INKA_MCP_URL), so a link can't have the token sent
 * anywhere else; and nothing is sent without the click, so a page that merely
 * opens the link gets nothing. Not signed in, the person signs in first (any
 * way the site offers) and comes back here.
 */
import { useSelector } from 'react-redux';
import { Redirect, useLocation } from 'react-router-dom';
import qs from 'query-string';
import jwtDecode from 'jwt-decode';
import { Container, Button, Message } from 'semantic-ui-react';
import Helmet from '@plone/volto/helpers/Helmet/Helmet';
import { runtimeConfig } from '@plone/volto/runtime_config';
import { agentRedirect } from './agentRedirect';

const ConnectAgent = () => {
  const location = useLocation();
  const token = useSelector((state) => state.userSession.token);
  const { redirect_uri: redirectUri, state, client } = qs.parse(location.search);

  if (!token) {
    return <Redirect to={`/login?return_url=${encodeURIComponent(`${location.pathname}${location.search}`)}`} />;
  }

  const refuse = (message) => (
    <Container className="connect-agent">
      <Helmet title="Connect an agent" />
      <h1>Connect an agent</h1>
      <Message negative>{message}</Message>
    </Container>
  );
  if (!redirectUri || !state) {
    return refuse('This link is incomplete: it needs the agent\'s address and its state. Start again from the agent.');
  }
  const where = agentRedirect(redirectUri, runtimeConfig.RAZZLE_INKA_MCP_URL);
  if (!where) {
    return refuse(`Your sign-in can be given only to an agent on this computer or to this site's MCP server, not to ${redirectUri}.`);
  }
  const asking = where === 'local'
    ? 'An agent on this computer is asking'
    : `${client || 'An MCP client'} is asking, through this site's MCP server,`;

  const answer = (fields) => (
    <form method="post" action={redirectUri}>
      {Object.entries(fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {fields.token
        ? <Button primary type="submit">Allow</Button>
        : <Button type="submit">Cancel</Button>}
    </form>
  );
  return (
    <Container className="connect-agent">
      <Helmet title="Connect an agent" />
      <h1>Connect an agent</h1>
      <p>
        {asking} to edit the site <strong>as {jwtDecode(token).sub}</strong>.
        It will be able to do anything you can. Allow it only if you started it.
      </p>
      <div style={{ display: 'flex', gap: '1em' }}>
        {answer({ token, state })}
        {answer({ error: 'access_denied', state })}
      </div>
    </Container>
  );
};

export default ConnectAgent;
