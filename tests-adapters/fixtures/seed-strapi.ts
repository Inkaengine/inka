import seed from './seed.json';

/**
 * Write the canonical fixture into a Strapi instance.
 *
 * Shared by the contract target and the journey rather than implemented twice:
 * the two suites then cannot disagree about what the fixture IS. The WordPress
 * pair — seedWordPress.ts and wp-blueprint-journey.json — has to be kept in
 * step by hand, and that is the drift this avoids.
 *
 * Parameterised by base url and token because the journey runs a SECOND Strapi
 * on its own port with its own database, so there is no one instance to assume.
 */
export async function seedStrapi({
  baseUrl,
  token,
}: {
  baseUrl: string;
  token: string;
}): Promise<void> {
  const authed = (path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });

  const existing = await authed(
    '/api/pages?pagination[pageSize]=200&status=draft',
  ).then((r) => r.json());
  for (const entry of existing?.data ?? []) {
    await authed(`/api/pages/${entry.documentId}`, { method: 'DELETE' });
  }

  // Parents first, so a child always has an id to point its parent relation at.
  // Strapi has no hierarchy of its own; the tree is that relation.
  const docs = seed.documents
    .filter((d: any) => d.path !== '/')
    .sort((a: any, b: any) => a.path.split('/').length - b.path.split('/').length);

  const idByPath = new Map<string, string>();
  for (const doc of docs as any[]) {
    const segments = doc.path.split('/').filter(Boolean);
    const parentPath = `/${segments.slice(0, -1).join('/')}`;
    const parent = segments.length === 1 ? null : idByPath.get(parentPath);

    const body = {
      data: {
        title: doc.title,
        slug: segments[segments.length - 1],
        ...(parent ? { parent } : {}),
        hydraBlocks: {
          blocks: doc.blocks ?? {},
          blocksLayout: doc.blocksLayout ?? { items: [] },
        },
      },
    };
    // `status=draft` writes the draft version WITHOUT publishing it. A plain
    // POST sets publishedAt immediately, which would make the fixture's
    // draft-post public and silently break the "a visitor cannot read a draft"
    // test.
    const query = doc.state === 'published' ? '' : '?status=draft';
    const res = await authed(`/api/pages${query}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        `Seeding ${doc.path} failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
    }
    idByPath.set(doc.path, (await res.json()).data.documentId);
  }
}
