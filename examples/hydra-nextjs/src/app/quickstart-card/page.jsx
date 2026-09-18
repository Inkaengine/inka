// app/[...slug]/page.jsx
'use client'
import { useState, useEffect } from 'react'
import { initBridge } from '@hydra-js/hydra.js'

export default function Page({ params }) {
  const [page, setPage] = useState(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    // Only init the bridge when loaded inside the editor.
    if (window.name.startsWith('hydra')) {
      setEditing(true)
      initBridge({
        // Declare the one block type we render richly.
        blocks: {
          card: { blockSchema: { properties: {
            image: { widget: 'image' },
            title: { type: 'string' },
            description: { type: 'string' },
            link: { widget: 'url' },
          } } },
        },
        // Re-render on every edit.
        onEditChange: setPage,
      })
    } else {
      // On the live site: fetch this page and render once.
      fetch(`/++api++/${params.slug?.join('/') || ''}`).then((r) => r.json()).then(setPage)
    }
  }, [])

  if (!page) return <div>Loading...</div>

  return page.blocks_layout?.items?.map((id) => {
    const block = page.blocks[id]
    // The card block is rendered editable; anything else is shown as raw JSON.
    if (block['@type'] !== 'card')
      return (
        <pre key={id} data-block-uid={editing ? id : undefined}>
          {JSON.stringify(block, null, 2)}
        </pre>
      )
    return (
      <div key={id} data-block-uid={editing ? id : undefined}>
        <a href={block.link} data-edit-link={editing ? 'link' : undefined}>
          <img src={block.image} data-edit-media={editing ? 'image' : undefined} />
          <h3 data-edit-text={editing ? 'title' : undefined}>{block.title}</h3>
          <p data-edit-text={editing ? 'description' : undefined}>{block.description}</p>
        </a>
      </div>
    )
  })
}
