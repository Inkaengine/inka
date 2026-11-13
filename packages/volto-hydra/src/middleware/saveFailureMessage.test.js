import saveFailureMessage from './saveFailureMessage';

/** A failed PATCH as Volto's api middleware dispatches it (a superagent error). */
const failure = (status, body, type = 'UPDATE_CONTENT_FAIL') => {
  const error = new Error(status >= 500 ? 'Internal Server Error' : 'Bad Request');
  error.status = status;
  error.response = { status, body, text: JSON.stringify(body) };
  return { type, error };
};

const run = (action) => {
  const next = vi.fn((a) => a);
  saveFailureMessage({})(next)(action);
  return next.mock.calls[0][0];
};

// What Volto's Edit shows as the toast's text on a failed save.
const shown = (action) =>
  action.error?.response?.body?.error?.message ||
  action.error?.response?.body?.message ||
  action.error?.response?.text;

describe('saveFailureMessage middleware', () => {
  // A production author got "Error: 'dict' object has no attribute 'startswith'"
  // on nine saves running, and asked what it meant.
  const crash = failure(500, {
    type: 'AttributeError',
    message: "'dict' object has no attribute 'startswith'",
  });

  it("says the page wasn't saved, that the changes are still here, and what to do", () => {
    const text = shown(run(crash));
    expect(text).toMatch(/wasn't saved/);
    expect(text).toMatch(/changes are still here/);
    expect(text).toMatch(/try saving again/i);
  });

  it("keeps the server's own words, for whoever supports the site", () => {
    expect(shown(run(crash))).toContain("AttributeError: 'dict' object has no attribute 'startswith'");
  });

  it('says so when the server sent no message (a proxy error page)', () => {
    const text = shown(run(failure(502, undefined)));
    expect(text).toMatch(/wasn't saved/);
    expect(text).toContain('502');
  });

  it("leaves the error itself alone: status and the agent API's message", () => {
    const out = run(crash);
    expect(out.error.status).toBe(500);
    expect(out.error.message).toBe('Internal Server Error');
    expect(out.error.response.body.type).toBe('AttributeError');
  });

  it('leaves a refusal the CMS explains alone (4xx: validation, permission)', () => {
    const refusal = failure(400, { message: '[{"field":"title","message":"Required"}]' });
    expect(run(refusal)).toBe(refusal);
  });

  it('leaves other actions alone', () => {
    const other = failure(500, { message: 'x' }, 'GET_CONTENT_FAIL');
    expect(run(other)).toBe(other);
    const ok = { type: 'UPDATE_CONTENT_SUCCESS' };
    expect(run(ok)).toBe(ok);
  });
});
