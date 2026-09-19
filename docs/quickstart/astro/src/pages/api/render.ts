// src/pages/api/render.ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container'
import BlockRenderer from '../../components/BlockRenderer.astro'

export const POST = async ({ request }) => {
  const { unit, formData } = await request.json()
  const container = await AstroContainer.create()
  // BlockRenderer.astro emits data-block-uid + data-edit-* attributes — the same
  // DOM contract as the other tabs, just produced server-side.
  const html = await container.renderToString(BlockRenderer, { props: { unit, formData } })
  return new Response(html, { headers: { 'Content-Type': 'text/html' } })
}
