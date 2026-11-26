/**
 * Redux middleware that words a failed page save for the author.
 *
 * When the CMS crashes on a save (a 5xx), Volto's Edit shows the server's
 * message as it is: a production author got "Error: 'dict' object has no
 * attribute 'startswith'" on nine saves running and had to ask what it meant,
 * or whether her work was lost. This says what happened (the page wasn't
 * saved), that the work is still in the editor, and what to do, and keeps the
 * server's own words for whoever supports the site.
 *
 * Only the message Edit shows (`response.body.message`) changes. The error's
 * status, its own message and the rest of the body stay as the server sent
 * them, for the agent API and anything else reading the refusal. A 4xx is the
 * CMS explaining a refusal (validation, permission), which Edit already shows
 * properly, so it is left alone.
 *
 * Edit reads the message from `state.content.update.error`, which the content
 * reducer copies from this action, so this is the one place to say it without
 * a shadow of Edit.
 */
const UPDATE_CONTENT_FAIL = 'UPDATE_CONTENT_FAIL';

export function savedFailureText(status, body) {
  const detail = body?.message
    ? `${body.type ? `${body.type}: ` : ''}${body.message}`
    : `server error ${status}`;
  return (
    "The page wasn't saved: the site couldn't store it. Your changes are still here, " +
    "so don't leave or reload the page. Try saving again; if it keeps failing, " +
    `tell whoever supports your site, quoting: ${detail}`
  );
}

const saveFailureMessage = (_store) => (next) => (action) => {
  const status = action.error?.status ?? action.error?.response?.status;
  if (action.type !== UPDATE_CONTENT_FAIL || !(status >= 500)) {
    return next(action);
  }
  const { error } = action;
  const body = error.response?.body;
  const worded = Object.assign(Object.create(Object.getPrototypeOf(error)), error, {
    message: error.message,
    response: {
      ...error.response,
      body: { ...(body || {}), message: savedFailureText(status, body) },
    },
  });
  return next({ ...action, error: worded });
};

export default saveFailureMessage;
