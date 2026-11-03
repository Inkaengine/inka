import jwtDecode from 'jwt-decode';

/**
 * Who holds a page's lock, when it is someone other than the user signed in
 * (`token`): `{ user, since }`, or null. The rule Volto's "This item was
 * locked by …" message uses, so an agent is told what a person would be.
 */
export function lockedBy(lock, token) {
  if (!lock?.locked) return null;
  if (lock.creator === signedInAs(token)) return null;
  return { user: lock.creator_name, since: lock.created };
}

/** The user id a session token is for (as the admin's App reads it). */
function signedInAs(token) {
  if (!token) throw new Error('lockedBy: no one is signed in to the admin');
  return jwtDecode(token).sub;
}
