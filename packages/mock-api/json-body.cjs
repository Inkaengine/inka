/**
 * Request bodies, read as plone.restapi reads them.
 *
 * Plone decodes a body only in the services that read one, through json_body
 * (plone/restapi/deserializer/__init__.py), whatever its Content-Type:
 *
 *     data = json.loads(request.get("BODY") or "{}")
 *     except ValueError: raise DeserializationError("No JSON object could be decoded")
 *     if not isinstance(data, dict): raise DeserializationError("Malformed body")
 *
 * So the server keeps every body as the text it was sent (express.text for any
 * type), and each handler that reads one calls jsonBody. A service that reads
 * none never fails on what it was sent.
 *
 * Most services let the error through, and plone.rest renders it: a 500, as
 * ZPublisher has no status for DeserializationError (renderUncaught). Content
 * PATCH and @sharing answer it with a 400, and @querystring-search turns it into
 * a BadRequest; those handlers catch it themselves.
 */

/**
 * plone.restapi's DeserializationError. Its str() is repr(msg), so the message
 * Plone sends carries the quotes: 'No JSON object could be decoded'.
 */
class DeserializationError extends Error {
  constructor(msg) {
    super(`'${msg}'`);
    this.name = 'DeserializationError';
  }
}

/** The request's body as an object, or a DeserializationError, as json_body. */
function jsonBody(req) {
  let data;
  try {
    data = JSON.parse(req.body || '{}');
  } catch {
    throw new DeserializationError('No JSON object could be decoded');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new DeserializationError('Malformed body');
  }
  return data;
}

/**
 * Error middleware: a DeserializationError no handler caught, as plone.rest's
 * ErrorHandling view renders it ({type, message}, with a 500).
 */
function renderUncaught(err, req, res, next) {
  if (!(err instanceof DeserializationError)) return next(err);
  res.status(500).json({ type: err.name, message: err.message });
}

module.exports = { DeserializationError, jsonBody, renderUncaught };
