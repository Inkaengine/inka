/**
 * The header's link into the editor.
 *
 * With a demo account on the admin (Inka's /login?demo), "Try editing now"
 * signs a visitor in as it and opens the page they are on in the editor.
 * Without one, the plain login.
 */
export function signInLink(adminUrl, pagePath, demoEditing) {
  if (!demoEditing) return { href: `${adminUrl}/login`, label: 'Login' };
  const page = pagePath.replace(/\/+$/, '');
  return {
    href: `${adminUrl}/login?demo&return_url=${encodeURIComponent(`${page}/edit`)}`,
    label: 'Try editing now',
  };
}
