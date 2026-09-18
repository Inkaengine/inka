---
"@type": Document
UID: docs-server-rendered-frontends-001
allow_discussion: false
contributors: []
creators:
  - admin
description: Hydra works with any frontend, including ones that have no client-side
effective: 2025-01-01T00:00:00
exclude_from_nav: false
expires: null
id: server-rendered-frontends
is_folderish: false
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects:
  - frontend
title: Server-rendered frontends
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
blocks-tagged: |
  <block type="slateTable">
    <region name="table.rows">
      <block type="row">
        <region name="cells">
          <block type="cell" value="${td/slate}" />
        </region>
      </block>
    </region>
  </block>
---

# Server-rendered frontends

Hydra works with any frontend, including ones that have no client-side reactivity at all — pure server-rendered frameworks like **Astro**, **PHP**, **Django**, **Rails**, **Laravel**, **Symfony**, **Go html/template**. The bridge ships a built-in pattern for these: one config option on `initBridge` and one small endpoint on your server.

## When you need this

If you're using React, Vue, Svelte, Solid, Next, Nuxt, or any framework with client-side reactivity, you don't need this. The bridge fires `FORM_DATA`, your framework reconciles the DOM, and only the changed nodes update. Contenteditable cursors, image loads, and scroll positions survive every edit "for free" because the virtual DOM diff doesn't touch unchanged nodes.

Server-rendered-only frameworks have no such reconciliation. If you naively swapped the whole content area's `innerHTML` on every `FORM_DATA`, every keystroke would destroy contenteditable cursors, reload images, jump scroll, and reset IME state. The editing experience would be visibly broken.

The fix is to update only the smallest block that changed, and let the rest of the DOM stay untouched. That's what the bridge does when you set `renderEndpoint`.

## How it works

### Text

```text
Admin (Volto)              Your server-rendered frontend
─────────────              ──────────────────────────────
hydra.js bridge   ────►    FORM_DATA postMessage
                           │
                           ▼
                           bridge calls findChangedUnit(prev, new)
                           │
                           ▼
                           unit = { unit: 'block', blockId: X }
                               OR { unit: 'page' }
                           │
                           ▼
                           POST renderEndpoint { unit, formData }
                           │
                           ▼
                           your endpoint renders the unit's HTML
                           │
                           ▼
                           bridge swaps [data-block-uid=X].outerHTML
                           (or renderContainer.innerHTML for page unit)
```

### The diff rule (built into `hydra.js`)

`findChangedUnit(prevFormData, newFormData)` walks the new form data against the previous one looking for the shallowest changed subtree. At each container level:

- `items` array differs (add/remove/reorder) → **this container is the unit**
- exactly one child differs AND `items` unchanged → recurse into that child
- 2 or more children differ → this container is the unit
- nothing differs → no-op (forms are equal)

Spans more than one nesting level (e.g. a block moved from one column to another) → falls back to `{ unit: 'page' }`. Most edits stay at one level because one focused field = one block.

### The `data-block-uid` contract

For the bridge to swap `[data-block-uid=X].outerHTML` reliably, every block's **outermost rendered element** must carry `data-block-uid={id}`. This is Astro-only / server-only — reactive frontends don't care because their reconciliation finds DOM nodes via virtual DOM, not query selectors.

The recommended pattern: write a `BlockRenderer` (or equivalent) wrapper in your templating language that puts the `<div data-block-uid={id}>` around every block before dispatching to the block's own template. Then block authors don't think about it — the wrapper IS the contract.

That dispatch must also handle `@type: "empty"` — the placeholder Hydra seeds into any container region with no `defaultBlockType` and more than one `allowedBlocks` — by rendering an empty, selectable slot (with its `data-block-uid`) rather than erroring. See [Empty Blocks](./container-blocks.md#empty-blocks).

## Worked example: Astro

### Js

```js
// src/main.js (bridge bootstrap, runs in the iframe child)
import { initBridge } from '@volto-hydra/hydra-js';

initBridge({
  page: { schema: { properties: { blocks_layout: { allowedBlocks: [...] } } } },
  blocks: { /* your block configs */ },
  renderEndpoint: '/api/render',
  renderContainer: '#content',   // optional, default '#content'
});
```

<block type="codeExample">

### Astro

```astro
---
// src/components/BlockRenderer.astro — enforces the data-block-uid contract.
import SlateBlock from './SlateBlock.astro';
import ImageBlock from './ImageBlock.astro';
// ...

const { block } = Astro.props;
const type = block?.['@type'];
const uid  = block?.['@uid'];
---
<div data-block-uid={uid}>
  {type === 'slate' && <SlateBlock block={block} />}
  {type === 'image' && <ImageBlock block={block} />}
  {/* ...one branch per block type... */}
</div>
```

</block>

### Ts

```ts
// src/pages/api/render.ts — the render endpoint.
import type { APIRoute } from 'astro';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import BlockRenderer from '../../components/BlockRenderer.astro';
import Content from '../../components/Content.astro';

export const POST: APIRoute = async ({ request }) => {
  const { unit, formData } = await request.json();
  const container = await AstroContainer.create();
  if (unit.unit === 'page') {
    const html = await container.renderToString(Content, { props: { formData } });
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  }
  // unit === 'block'
  const block = findBlockById(formData, unit.blockId);
  const html = await container.renderToString(BlockRenderer, { props: { block } });
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
};

function findBlockById(formData, blockId) {
  const blocks = formData?.blocks;
  if (!blocks) return null;
  if (blocks[blockId]) return { ...blocks[blockId], '@uid': blockId };
  for (const child of Object.values(blocks)) {
    const inside = findBlockById(child, blockId);
    if (inside) return inside;
  }
  return null;
}
```

The full working example lives at [\`docs/examples/test-astro/\`](https://github.com/collective/volto-hydra/tree/main/docs/examples/test-astro) with block components in [\`docs/examples/examples/astro/\`](https://github.com/collective/volto-hydra/tree/main/docs/examples/examples/astro).

## Worked example: PHP

### Php

```php
<!-- blocks/_renderer.php — enforces the data-block-uid contract -->
<div data-block-uid="<?= htmlspecialchars($block['@uid']) ?>">
  <?php
    $tpl = __DIR__ . "/{$block['@type']}.php";
    if (file_exists($tpl)) include $tpl;
  ?>
</div>
```

<block type="codeExample">

### Php

```php
<!-- blocks/slate.php — one file per block type -->
<div data-edit-text="value">
  <?php foreach ($block['value'] ?? [] as $node) include __DIR__ . '/_slate_node.php'; ?>
</div>
```

</block>

### Php

```php
<?php
// api/render.php — the render endpoint
header('Content-Type: text/html');

$payload  = json_decode(file_get_contents('php://input'), true);
$unit     = $payload['unit'];
$formData = $payload['formData'];

if ($unit['unit'] === 'page') {
    foreach ($formData['blocks_layout']['items'] as $id) {
        $block = array_merge($formData['blocks'][$id], ['@uid' => $id]);
        include __DIR__ . '/../blocks/_renderer.php';
    }
} else {
    $block = find_block_by_id($formData, $unit['blockId']);
    include __DIR__ . '/../blocks/_renderer.php';
}

function find_block_by_id($data, $blockId) {
    $blocks = $data['blocks'] ?? [];
    if (isset($blocks[$blockId])) {
        return array_merge($blocks[$blockId], ['@uid' => $blockId]);
    }
    foreach ($blocks as $child) {
        $found = find_block_by_id($child, $blockId);
        if ($found) return $found;
    }
    return null;
}
```

The HTML page that loads in the editor iframe just needs to pull in the bridge and call `initBridge` with the endpoint:

### Html

```html
<!-- index.php (or a static index.html) -->
<!DOCTYPE html>
<html>
<head><title>My PHP frontend</title></head>
<body>
  <div id="content"></div>
  <script type="module">
    import { initBridge } from '/static/hydra.js';
    initBridge({
      page: { schema: { properties: { blocks_layout: { allowedBlocks: [...] } } } },
      blocks: { /* ... */ },
      renderEndpoint: '/api/render.php',
    });
  </script>
</body>
</html>
```

## Adapting for Django / Rails / Laravel / Symfony / Go

The recipe is the same in every framework — only the rendering call changes:

<block type="slateTable" table.fixed table.celled>

| Framework | Render call |
| --- | --- |
| Astro | `AstroContainer.renderToString(Component, { props })` |
| PHP | `ob_start(); include "blocks/{$type}.php"; return ob_get_clean();` |
| Django | `render_to_string(f'blocks/{type}.html', {'block': data})` |
| Rails | `render_to_string("blocks/#{type}", locals: { block: data })` |
| Laravel | `view("blocks.{$type}", ['block' => $data])->render()` |
| Symfony (Twig) | `$twig->render("blocks/{$type}.html.twig", ['block' => $data])` |
| Go templates | `tpl.ExecuteTemplate(buf, type, data); return buf.String()` |

</block>

Everything else — the diff, the POST, the swap, the `data-block-uid` contract — is identical because the bridge handles it.

## Caveats

- **Network round trip per edit.** Faster than full reload (Sanity's

approach) but slower than client-side reconciliation. For a typical   edit (one block at a time) it's a few hundred bytes and a few   milliseconds on a same-origin endpoint. Don't put the endpoint behind   authentication that adds another round trip.

- **\`data-block-uid\` MUST be the outer element.** A wrapper around the

block from outside the renderer (e.g. a CSS-grid `<li>` your layout   adds) will break `outerHTML` swaps — the swap would replace the wrapper   too. Always wrap inside the renderer.

- **The endpoint must be on the same origin** as the rendered page (or

CORS-enabled). The bridge POSTs from the iframe child to whatever URL   you give it; cross-origin without CORS will fail.

- **The endpoint receives the full formData on every edit.** Don't log

it to disk or replay it — it's editing state, potentially containing   unpublished content.
