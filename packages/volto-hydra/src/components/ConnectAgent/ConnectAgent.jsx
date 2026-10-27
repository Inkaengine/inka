/**
 * /connect-agent?redirect_uri=…&state=… — a person signed in to the admin
 * allows an agent on their computer (the Inka MCP server) to act as them.
 *
 * On Allow, their token is posted, with the agent's `state`, to the agent's
 * listener; on Cancel, only `error=access_denied` and the state. The listener
 * must be on this computer's loopback address, so a link can't have the
 * token sent to another site; and nothing is sent without the click, so a
 * page that merely opens the link gets nothing. Not signed in, the person
 * signs in first (any way the site offers) and comes back here.
 */
import { useSelector } from 'react-redux';
import { Redirect, useLocation } from 'react-router-dom';
import qs from 'query-string';
import jwtDecode from 'jwt-decode';
import { Container, Button, Message } from 'semantic-ui-react';
import Helmet from '@plone/volto/helpers/Helmet/Helmet';
import { loopbackRedirect } from './loopbackRedirect';

const ConnectAgent = () => {
  const location = useLocation();
  const token = useSelector((state) => state.userSession.token);
  const { redirect_uri: redirectUri, state } = qs.parse(location.search);

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
  if (!loopbackRedirect(redirectUri)) {
    return refuse(`Your sign-in can be given only to an agent on this computer, not to ${redirectUri}.`);
  }

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
        An agent on this computer is asking to edit the site <strong>as {jwtDecode(token).sub}</strong>.
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
