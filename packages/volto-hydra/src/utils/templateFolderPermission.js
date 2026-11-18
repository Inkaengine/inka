/**
 * Whether a new template may be created in a folder: it needs "Add portal
 * content" there, which the folder's own `can_add` says.
 *
 * When the editor can't see the folder (401/403: may not read it; 404: not
 * there to read), it goes on without knowing and leaves the create to the
 * server, which refuses it if it must. Any other failure (the server down, a
 * bug) is raised, not taken as permission.
 *
 * @param {{ get: function(string): Promise<Object> }} api - Volto's Api client
 * @param {string} folder - the folder's path
 * @throws {Error} with `isPermissionError`, when the folder refuses new content
 */
export async function assertCanAddTo(api, folder) {
  let target;
  try {
    target = await api.get(folder);
  } catch (error) {
    if ([401, 403, 404].includes(error?.status)) return;
    throw error;
  }
  if (target?.can_add === false) {
    const err = new Error(
      `You don't have permission to add templates in "${folder}" (requires “Add portal content”).`,
    );
    err.isPermissionError = true;
    throw err;
  }
}
