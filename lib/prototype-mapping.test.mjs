/**
 * Prototype-tag mapping (design: docs/superpowers/specs/2026-08-14-blockmd-unified-mapping-design.md).
 *
 * A prototype is a `<block>` tag read declaratively. Its `${type/part}` refs
 * are the pattern: they both locate the markdown nodes an instance spans and
 * map them to fields. These tests build the mechanism up from the simplest
 * case (one node -> one block) toward the accordion (scoped prototypes,
 * refs-as-pattern, implicit remainder region).
 */
import { describe, it, expect } from 'vitest';
import { parsePrototypes, matchBlocks, keyBlocks, unkeyBlocks, emitBlocks, emitPage, decodePage } from './prototype-mapping.mjs';

describe('prototype mapping', () => {
  it('maps a paragraph to a slate block via a single-node prototype', () => {
    const protos = parsePrototypes('<block type="slate" value="${p/slate}" />');
    const blocks = matchBlocks(protos, 'Hello world.');
    expect(blocks).toEqual([
      { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Hello world.' }] }] },
    ]);
  });

  it('maps a paragraph + image to one image block via a two-node prototype', () => {
    const protos = parsePrototypes(
      '<block type="image" description="${p/text}" url="${img/src}" alt="${img/alt}" />',
    );
    const blocks = matchBlocks(protos, 'A caption.\n\n![alt text](/img.png)');
    expect(blocks).toEqual([
      { '@type': 'image', description: 'A caption.', url: '/img.png', alt: 'alt text' },
    ]);
  });

  it('prefers the longer pattern, falling back to the shorter (leftmost-longest)', () => {
    const protos = parsePrototypes([
      '<block type="slate" value="${p/slate}" />',
      '<block type="image" description="${p/text}" url="${img/src}" alt="${img/alt}" />',
    ].join('\n'));
    // A lone paragraph -> slate (the 2-node image pattern can't match two
    // paragraphs); a paragraph + image -> image.
    const blocks = matchBlocks(protos, 'Just prose.\n\nA caption.\n\n![alt](/i.png)');
    expect(blocks).toEqual([
      { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Just prose.' }] }] },
      { '@type': 'image', description: 'A caption.', url: '/i.png', alt: 'alt' },
    ]);
  });

  it('scopes a panel prototype in a region and splits the accordion at each h2', () => {
    // The accordion prototype nests a region whose `panel` item is delimited by
    // h2; the panel's content is the implicit remainder. (uid-keying deferred:
    // panel content is asserted as an ordered `blocks` list, not a dict.)
    const protos = parsePrototypes([
      '<block type="slate" value="${p/slate}" />',
      '<block type="accordion" right_arrows=true>',
      '  <region name="panels" widget="object_list">',
      '    <block type="panel" title="${h2/text}" />',
      '  </region>',
      '</block>',
    ].join('\n'));
    const md = [
      '<block type="accordion">', '',
      '## First', '', 'First body.', '',
      '## Second', '', 'Second body.', '',
      '</block>',
    ].join('\n');
    const blocks = matchBlocks(protos, md);
    expect(blocks).toEqual([{
      '@type': 'accordion',
      right_arrows: true, // literal-attr coercion (string -> boolean) deferred
      panels: [
        { title: 'First', blocks: [{ '@type': 'slate', value: [{ type: 'p', children: [{ text: 'First body.' }] }] }] },
        { title: 'Second', blocks: [{ '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Second body.' }] }] }] },
      ],
    }]);
  });
});

describe('uid keying', () => {
  it('keys a flat block list into a blocks dict + blocks_layout from assignments', () => {
    const blocks = [
      { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'A' }] }] },
      { '@type': 'separator', styles: { align: 'left' } },
    ];
    const assignments = [
      { uid: 'p-1', type: 'slate' },
      { uid: 'sep-1', type: 'separator' },
    ];
    expect(keyBlocks(blocks, assignments, accProto)).toEqual({
      blocks: {
        'p-1': { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'A' }] }] },
        'sep-1': { '@type': 'separator', styles: { align: 'left' } },
      },
      blocks_layout: { items: ['p-1', 'sep-1'] },
    });
  });

  it('fails loudly when an assignment type does not anchor the block type', () => {
    const blocks = [{ '@type': 'slate', value: [] }];
    const assignments = [{ uid: 'x-1', type: 'image' }];
    expect(() => keyBlocks(blocks, assignments)).toThrow(/anchor|type/i);
  });

  const accProto = parsePrototypes([
    '<block type="accordion">',
    '  <region name="panels" widget="object_list">',
    '    <block type="panel" title="${h2/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'));

  it('keys a nested accordion depth-first: block uid, panel @id, then child uids', () => {
    const blocks = [{
      '@type': 'accordion', right_arrows: true,
      panels: [
        { title: 'First', blocks: [{ '@type': 'slate', value: [{ type: 'p', children: [{ text: 'A' }] }] }] },
        { title: 'Second', blocks: [{ '@type': 'slate', value: [{ type: 'p', children: [{ text: 'B' }] }] }] },
      ],
    }];
    const assignments = [
      { uid: 'acc-1', type: 'accordion' },
      { id: 'panel-1' },
      { uid: 's-1', type: 'slate' },
      { id: 'panel-2' },
      { uid: 's-2', type: 'slate' },
    ];
    expect(keyBlocks(blocks, assignments, accProto)).toEqual({
      blocks: {
        'acc-1': {
          '@type': 'accordion', right_arrows: true,
          panels: [
            { '@id': 'panel-1', title: 'First', blocks: { 's-1': { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'A' }] }] } }, blocks_layout: { items: ['s-1'] } },
            { '@id': 'panel-2', title: 'Second', blocks: { 's-2': { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'B' }] }] } }, blocks_layout: { items: ['s-2'] } },
          ],
        },
      },
      blocks_layout: { items: ['acc-1'] },
    });
  });

  it('decodes accordion markdown end-to-end: matchBlocks then keyBlocks', () => {
    const protos = parsePrototypes([
      '<block type="slate" value="${p/slate}" />',
      '<block type="accordion" right_arrows=true>',
      '  <region name="panels" widget="object_list">',
      '    <block type="panel" title="${h2/text}" />',
      '  </region>',
      '</block>',
    ].join('\n'));
    const md = [
      '<block type="accordion">', '',
      '## First', '', 'First body.', '',
      '## Second', '', 'Second body.', '',
      '</block>',
    ].join('\n');
    const assignments = [
      { uid: 'acc-1', type: 'accordion' },
      { id: 'panel-1' }, { uid: 's-1', type: 'slate' },
      { id: 'panel-2' }, { uid: 's-2', type: 'slate' },
    ];
    const keyed = keyBlocks(matchBlocks(protos, md), assignments, protos);
    expect(keyed.blocks['acc-1'].panels.map((p) => [p['@id'], p.title, p.blocks_layout.items])).toEqual([
      ['panel-1', 'First', ['s-1']],
      ['panel-2', 'Second', ['s-2']],
    ]);
    expect(keyed.blocks['acc-1'].panels[0].blocks['s-1'].value)
      .toEqual([{ type: 'p', children: [{ text: 'First body.' }] }]);
    expect(keyed.blocks_layout).toEqual({ items: ['acc-1'] });
  });

  it('mints uids when assignments are empty, preserving order and structure', () => {
    const blocks = [
      { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'A' }] }] },
      { '@type': 'separator', styles: { align: 'left' } },
    ];
    const keyed = keyBlocks(blocks, [], accProto);
    const ids = keyed.blocks_layout.items;
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);                 // unique
    expect(Object.keys(keyed.blocks)).toEqual(ids);    // dict keys track layout order
    expect(keyed.blocks[ids[0]]['@type']).toBe('slate');
    expect(keyed.blocks[ids[1]]['@type']).toBe('separator');
    expect(keyed.blocks[ids[0]].value).toEqual([{ type: 'p', children: [{ text: 'A' }] }]);
  });

  it('mints panel @ids and child uids for a container when assignments are empty', () => {
    const blocks = [{
      '@type': 'accordion', right_arrows: true,
      panels: [
        { title: 'First', blocks: [{ '@type': 'slate', value: [{ type: 'p', children: [{ text: 'A' }] }] }] },
        { title: 'Second', blocks: [{ '@type': 'slate', value: [{ type: 'p', children: [{ text: 'B' }] }] }] },
      ],
    }];
    const keyed = keyBlocks(blocks, [], accProto);
    const accId = keyed.blocks_layout.items[0];
    const panels = keyed.blocks[accId].panels;
    const ids = [accId, ...panels.map((p) => p['@id']), ...panels.flatMap((p) => p.blocks_layout.items)];
    expect(new Set(ids).size).toBe(ids.length);        // every minted id unique across the page
    expect(panels.map((p) => p.title)).toEqual(['First', 'Second']);
    const child0 = panels[0].blocks_layout.items[0];
    expect(panels[0].blocks[child0]['@type']).toBe('slate');
    expect(panels[0].blocks[child0].value).toEqual([{ type: 'p', children: [{ text: 'A' }] }]);
  });
});

describe('object_list idField (schema-free, named on the region)', () => {
  const protos = () => parsePrototypes([
    '<block type="tbl">',
    '  <region name="rows" widget="object_list" idField="key">',
    '    <block type="row" label="${h3/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'));
  const body = '<block type="tbl">\n\n### Row A\n\n### Row B\n\n</block>';

  it('keys object_list items by the region idField, not a hardcoded @id', () => {
    const keyed = keyBlocks(matchBlocks(protos(), body), [], protos()); // [] = mint uids/ids
    const tbl = Object.values(keyed.blocks)[0];
    expect(Object.keys(tbl.rows[0]).sort()).toEqual(['key', 'label']); // keyed by `key`, no @id
    expect(tbl.rows[0].label).toBe('Row A');
    expect(typeof tbl.rows[0].key).toBe('string');
  });

  it('round-trips: unkey reads the item id back from the idField', () => {
    const p = protos();
    const keyed = keyBlocks(matchBlocks(p, body), [], p);
    const { blocks } = unkeyBlocks(keyed, p);
    // the idField is stripped from the emitted item (it becomes an assignment)
    expect(blocks[0].rows).toEqual([{ label: 'Row A' }, { label: 'Row B' }]);
  });

  it('still defaults to @id when the region names no idField', () => {
    const p = parsePrototypes([
      '<block type="tbl">',
      '  <region name="rows" widget="object_list">',
      '    <block type="row" label="${h3/text}" />',
      '  </region>',
      '</block>',
    ].join('\n'));
    const keyed = keyBlocks(matchBlocks(p, body), [], p);
    expect(Object.keys(Object.values(keyed.blocks)[0].rows[0]).sort()).toEqual(['@id', 'label']);
  });
});

describe('emit', () => {
  it('emits a slate block as bare paragraph markdown', () => {
    const protos = parsePrototypes('<block type="slate" value="${p/slate}" />');
    const block = { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Hello world.' }] }] };
    expect(emitBlocks(protos, [block])).toBe('Hello world.');
  });
});

describe('emit multi-node', () => {
  it('emits an image-with-caption block as paragraph + image markdown', () => {
    const protos = parsePrototypes(
      '<block type="image" description="${p/text}" url="${img/src}" alt="${img/alt}" />',
    );
    const block = { '@type': 'image', description: 'A caption.', url: '/img.png', alt: 'alt text' };
    expect(emitBlocks(protos, [block])).toBe('A caption.\n\n![alt text](/img.png)');
  });
});

describe('verify-on-emit', () => {
  it('falls back to a tag when the bare form would over-merge with a neighbour', () => {
    const protos = parsePrototypes([
      '<block type="slate" value="${p/slate}" />',
      '<block type="image" description="${p/text}" url="${img/src}" alt="${img/alt}" />',
      '<block type="image" url="${img/src}" alt="${img/alt}" />',
    ].join('\n'));
    // Bare, "Prose." + an image would re-decode as ONE image-with-caption.
    // Verify-on-emit must break that up so it round-trips to two blocks.
    const blocks = [
      { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Prose.' }] }] },
      { '@type': 'image', url: '/i.png', alt: 'a' },
    ];
    const md = emitBlocks(protos, blocks);
    expect(matchBlocks(protos, md)).toEqual(blocks);
  });
});

describe('emit container', () => {
  const protos = parsePrototypes([
    '<block type="slate" value="${p/slate}" />',
    '<block type="accordion" right_arrows=true>',
    '  <region name="panels" widget="object_list">',
    '    <block type="panel" title="${h2/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'));

  it('emits an accordion as a block tag with h2-delimited panels, round-tripping', () => {
    const block = {
      '@type': 'accordion', right_arrows: true,
      panels: [
        { title: 'First', blocks: [{ '@type': 'slate', value: [{ type: 'p', children: [{ text: 'First body.' }] }] }] },
        { title: 'Second', blocks: [{ '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Second body.' }] }] }] },
      ],
    };
    const md = emitBlocks(protos, [block]);
    expect(md).toContain('## First');
    expect(md).toContain('<block type="accordion">');
    expect(matchBlocks(protos, md)).toEqual([block]);
  });
});

describe('emitPage / full page round-trip', () => {
  const protos = parsePrototypes([
    '<block type="slate" value="${p/slate}" />',
    '<block type="accordion" right_arrows=true>',
    '  <region name="panels" widget="object_list">',
    '    <block type="panel" title="${h2/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'));

  const keyed = {
    blocks: {
      'acc-1': {
        '@type': 'accordion', right_arrows: true,
        panels: [
          { '@id': 'panel-1', title: 'First', blocks: { 's-1': { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'First body.' }] }] } }, blocks_layout: { items: ['s-1'] } },
          { '@id': 'panel-2', title: 'Second', blocks: { 's-2': { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Second body.' }] }] } }, blocks_layout: { items: ['s-2'] } },
        ],
      },
    },
    blocks_layout: { items: ['acc-1'] },
  };

  it('reads uids straight from the keyed shape, depth-first', () => {
    const { assignments } = emitPage(protos, keyed);
    expect(assignments).toEqual([
      { uid: 'acc-1' },
      { id: 'panel-1' }, { uid: 's-1' },
      { id: 'panel-2' }, { uid: 's-2' },
    ]);
  });

  it('emits (markdown, assignments) that decode back to the identical keyed page', () => {
    const { markdown, assignments } = emitPage(protos, keyed);
    expect(keyBlocks(matchBlocks(protos, markdown), assignments, protos)).toEqual(keyed);
  });
});

describe('separator (zero-capture node directive)', () => {
  it('decodes --- to a separator and emits it back', () => {
    const protos = parsePrototypes('<block type="separator" _="${hr}" />');
    expect(matchBlocks(protos, '---')).toEqual([{ '@type': 'separator' }]);
    expect(emitBlocks(protos, [{ '@type': 'separator' }])).toBe('---');
  });
});

describe('decodePage (full page: frontmatter + prototypes + assignments + body -> JSON)', () => {
  it('reconstructs block JSON from a markdown page', () => {
    const md = [
      '---',
      '"@type": Document',
      'title: Hi',
      'assignments:',
      '  - { uid: p-1, type: slate }',
      '  - { uid: sep-2, type: separator }',
      'prototypes: |',
      '  <block type="slate" value="${p/slate}" />',
      '  <block type="separator" _="${hr}" />',
      '---',
      '',
      'Hello world.',
      '',
      '---',
      '',
    ].join('\n');
    expect(decodePage(md)).toEqual({
      '@type': 'Document',
      title: 'Hi',
      blocks: {
        'p-1': { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Hello world.' }] }] },
        'sep-2': { '@type': 'separator' },
      },
      blocks_layout: { items: ['p-1', 'sep-2'] },
    });
  });

  it('reads the two-section format: blocks-matched / blocks-tagged / blocks-assignments', () => {
    const md = [
      '---',
      '"@type": Document',
      'blocks-assignments:',       // lean: uid only, type derived from the match
      '  - { uid: h-1 }',
      '  - { uid: b-2 }',
      'blocks-matched: |',         // implicit — auto-matched from bare markdown
      '  <block type="slate" value="${p,h*/slate}" />',
      'blocks-tagged: |',          // explicit — only via its tag
      '  <block type="button" title="${p/text}" href="${p/link}" />',
      '---',
      '',
      '# A heading',
      '',
      '<block type="button">',
      '',
      '[Docs](/docs)',
      '',
      '</block>',
      '',
    ].join('\n');
    const page = decodePage(md);
    expect(page.blocks['h-1']).toEqual({ '@type': 'slate', value: [{ type: 'h1', children: [{ text: 'A heading' }] }] });
    expect(page.blocks['b-2']['@type']).toBe('button');
    expect(page.blocks['b-2'].href).toEqual([{ '@id': '/docs' }]);
    expect(page.blocks_layout.items).toEqual(['h-1', 'b-2']);
  });
});

describe('title (match-only h1)', () => {
  it('matches an h1 to a bare title block, storing nothing from it', () => {
    const protos = parsePrototypes('<block type="title" _="${h1}" />');
    expect(matchBlocks(protos, '# Hello')).toEqual([{ '@type': 'title' }]);
  });
});

describe('alternation (slate default over many node kinds)', () => {
  it('a heading decodes to slate via a node set', () => {
    const protos = parsePrototypes('<block type="slate" value="${p|h2|h3/slate}" />');
    expect(matchBlocks(protos, '## A heading'))
      .toEqual([{ '@type': 'slate', value: [{ type: 'h2', children: [{ text: 'A heading' }] }] }]);
  });

  it('breaks an equal-specificity tie by source order — later prototype wins (CSS cascade)', () => {
    // `${h1}` and the `${…h1…}` set are both type-level (equal specificity), so
    // they tie; title declared AFTER slate wins the h1, like a later CSS rule.
    const protos = parsePrototypes([
      '<block type="slate" value="${p,h1,h2/slate}" />',
      '<block type="title" _="${h1}" />',
    ].join('\n'));
    expect(matchBlocks(protos, '# Title\n\n## Sub')).toEqual([
      { '@type': 'title' },
      { '@type': 'slate', value: [{ type: 'h2', children: [{ text: 'Sub' }] }] },
    ]);
  });

  it('the earlier prototype loses the tie — title BEFORE slate makes an h1 a slate', () => {
    const protos = parsePrototypes([
      '<block type="title" _="${h1}" />',
      '<block type="slate" value="${p,h1,h2/slate}" />',
    ].join('\n'));
    expect(matchBlocks(protos, '# X')).toEqual([
      { '@type': 'slate', value: [{ type: 'h1', children: [{ text: 'X' }] }] },
    ]);
  });

  it('a multi-node run is more specific (compound) and outranks a single-node prototype', () => {
    // image+caption (2 type slots) beats bare slate (1) by specificity, though declared first
    const protos = parsePrototypes([
      '<block type="image" description="${p/text}" url="${img/src}" />',
      '<block type="slate" value="${p,h*/slate}" />',
    ].join('\n'));
    const md = '![alt](/x.png)\n\ncaption text';
    expect(matchBlocks(protos, md)).toEqual([
      { '@type': 'image', description: 'caption text', url: '/x.png' },
    ]);
  });
});

describe('lone-bold/italic paragraph parts', () => {
  // topNodes lifts a paragraph whose only child is a strong/em into that node,
  // so a ref can target it directly (`${em/…}`). The part accessors must put the
  // paragraph wrapper back — a slate value is a list of block nodes, not an inline.
  it('${em/slate} reconstructs the paragraph around a lifted italic', () => {
    const protos = parsePrototypes('<block type="x" value="${em/slate}" />');
    expect(matchBlocks(protos, '*just italic*')).toEqual([{
      '@type': 'x',
      value: [{ type: 'p', children: [{ type: 'em', children: [{ text: 'just italic' }] }] }],
    }]);
  });

  it('${em/richtext} yields a {value} rich-text field (plaintext is derived, not stored)', () => {
    const protos = parsePrototypes('<block type="hero" description="${em/richtext}" />');
    expect(matchBlocks(protos, '*Fitted, not forced.*')).toEqual([{
      '@type': 'hero',
      description: { value: [{ type: 'p', children: [{ type: 'em', children: [{ text: 'Fitted, not forced.' }] }] }] },
    }]);
  });
});

describe('codeExample (tabs region over pre fences)', () => {
  it('decodes tabs split at h3, each a label + fenced code', () => {
    const protos = parsePrototypes([
      '<block type="codeExample">',
      '  <region name="tabs" widget="object_list">',
      '    <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />',
      '  </region>',
      '</block>',
    ].join('\n'));
    const md = [
      '<block type="codeExample">', '',
      '### Bash', '', '```bash', 'echo hi', '```', '',
      '### JS', '', '```javascript', 'console.log(1)', '```', '',
      '</block>',
    ].join('\n');
    expect(matchBlocks(protos, md)).toEqual([{
      '@type': 'codeExample',
      tabs: [
        { label: 'Bash', language: 'bash', code: 'echo hi' },
        { label: 'JS', language: 'javascript', code: 'console.log(1)' },
      ],
    }]);
  });
});

describe('tier-3 data tag decode', () => {
  it('reconstructs a raw block from a self-closing data tag', () => {
    const protos = parsePrototypes('<block type="slate" value="${p/slate}" />');
    const md = '<block type="separator" data-json=\'{"styles":{"align":"left"}}\' />';
    expect(matchBlocks(protos, md)).toEqual([{ '@type': 'separator', styles: { align: 'left' } }]);
  });

  it('keeps string attrs and drops the redundant uid (keying supplies it)', () => {
    const protos = parsePrototypes('<block type="slate" value="${p/slate}" />');
    const md = '<block type="button" uid="b-1" title="Go" data-json=\'{"inneralign":"left"}\' />';
    expect(matchBlocks(protos, md)).toEqual([{ '@type': 'button', title: 'Go', inneralign: 'left' }]);
  });
});

describe('codeExample emit + tier-3 emit', () => {
  const cx = parsePrototypes([
    '<block type="codeExample">',
    '  <region name="tabs" widget="object_list">',
    '    <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'));

  it('emits a codeExample back to wrapped tabs (round-trip)', () => {
    const block = { '@type': 'codeExample', tabs: [
      { label: 'Bash', language: 'bash', code: 'echo hi' },
      { label: 'JS', language: 'javascript', code: 'console.log(1)' },
    ] };
    expect(matchBlocks(cx, emitBlocks(cx, [block]))).toEqual([block]);
  });

  it('emits an un-prototyped type as a tier-3 data tag that decodes back', () => {
    const block = { '@type': 'button', title: 'Go', inneralign: 'left' };
    expect(matchBlocks(cx, emitBlocks(cx, [block]))).toEqual([block]);
  });
});

describe('slateTable (iterate-children regions)', () => {
  const protos = parsePrototypes([
    '<block type="slateTable">',
    '  <region name="table.rows">',
    '    <block type="row">',
    '      <region name="cells">',
    '        <block type="cell" value="${td/slate}" />',
    '      </region>',
    '    </block>',
    '  </region>',
    '</block>',
  ].join('\n'));

  it('decodes table -> rows -> cells, each cell value a slate paragraph', () => {
    const md = ['<block type="slateTable">', '', '| A | B |', '| --- | --- |', '| c | d |', '', '</block>'].join('\n');
    const r = matchBlocks(protos, md);
    expect(r[0]['@type']).toBe('slateTable');
    expect(r[0].table.rows.map((row) => row.cells.map((c) => c.value[0].children[0].text)))
      .toEqual([['A', 'B'], ['c', 'd']]);
  });
});

describe('typed attributes', () => {
  it('decodes HTML booleans (bare=true), unquoted numbers, quoted strings', () => {
    const protos = parsePrototypes('<block type="slate" value="${p/slate}" />');
    const md = '<block type="toc" celled levels=3 title="Contents" />';
    expect(matchBlocks(protos, md)).toEqual([{ '@type': 'toc', celled: true, levels: 3, title: 'Contents' }]);
  });
});

describe('slateTable round-trip', () => {
  const protos = parsePrototypes([
    '<block type="slateTable">',
    '  <region name="table.rows">',
    '    <block type="row">',
    '      <region name="cells">',
    '        <block type="cell" value="${td/slate}" />',
    '      </region>',
    '    </block>',
    '  </region>',
    '</block>',
  ].join('\n'));

  it('emits a markdown table and decodes back (header derived, keys ignored)', () => {
    const cell = (t, x) => ({ type: t, value: [{ type: 'p', children: [{ text: x }] }] });
    const block = { '@type': 'slateTable', table: { rows: [
      { cells: [cell('header', 'A'), cell('header', 'B')] },
      { cells: [cell('data', 'c'), cell('data', 'd')] },
    ] } };
    const md = emitBlocks(protos, [block]);
    expect(md).toContain('| A | B |');
    expect(matchBlocks(protos, md)).toEqual([block]);
  });
});

describe('gridBlock (scoped teaser, blocks_layout, no per-card wrapper)', () => {
  const protos = parsePrototypes([
    '<block type="slate" value="${p|h2/slate}" />',
    '<block type="image" url="${img/src}" alt="${img/alt}" />',
    '<block type="gridBlock">',
    '  <region name="blocks" widget="blocks_layout">',
    '    <block type="teaser" title="${h2/text}" description="${p/text}" url="${img/src}" />',
    '  </region>',
    '</block>',
  ].join('\n'));

  it('reads each ## card + copy + image as a teaser, and round-trips', () => {
    const md = [
      '<block type="gridBlock">', '',
      '## Card One', '', 'Copy one.', '', '![](/a)', '',
      '## Card Two', '', 'Copy two.', '', '![](/b)', '',
      '</block>',
    ].join('\n');
    const block = matchBlocks(protos, md)[0];
    expect(block['@type']).toBe('gridBlock');
    expect(block.blocks.map((t) => [t['@type'], t.title, t.description, t.url])).toEqual([
      ['teaser', 'Card One', 'Copy one.', '/a'],
      ['teaser', 'Card Two', 'Copy two.', '/b'],
    ]);
    // the scoped teaser is inside the grid; the same markdown outside would be slate/image
    expect(matchBlocks(protos, '## Solo\n\nText.').every((b) => b['@type'] === 'slate')).toBe(true);
  });
});

describe('columns (nested blocks_layout container-in-container)', () => {
  const protos = parsePrototypes([
    '<block type="slate" value="${p,strong,em/slate}" />',
    '<block type="columns">',
    '  <region name="columns" widget="blocks_layout">',
    '    <block type="column">',
    '      <region name="items" widget="blocks_layout" />',
    '    </block>',
    '  </region>',
    '</block>',
  ].join('\n'));

  it('decodes columns -> column -> slates, ordered by the region\'s own layout key', () => {
    const md = [
      '<block type="columns">', '',
      '<block type="column">', '', '**Compliance**', '', 'Body one.', '', '</block>', '',
      '<block type="column">', '', '**Design**', '', 'Body two.', '', '</block>', '',
      '</block>',
    ].join('\n');
    const block = matchBlocks(protos, md)[0];
    expect(block['@type']).toBe('columns');
    // region name "columns" -> children at block.columns; nested "items" -> block.items
    expect(block.columns.map((c) => c['@type'])).toEqual(['column', 'column']);
    expect(block.columns[0].items.map((s) => s['@type'])).toEqual(['slate', 'slate']);
  });
});

describe('h* any heading', () => {
  it('matches any heading level for the slate default', () => {
    const protos = parsePrototypes('<block type="slate" value="${p|h*/slate}" />');
    expect(matchBlocks(protos, '#### Deep')).toEqual([{ '@type': 'slate', value: [{ type: 'h4', children: [{ text: 'Deep' }] }] }]);
    expect(matchBlocks(protos, 'Text.')).toEqual([{ '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Text.' }] }] }]);
  });
});

describe('relative heading depth ${h}', () => {
  const protos = parsePrototypes([
    '<block type="slate" value="${p|h*/slate}" />',
    '<block type="accordion">',
    '  <region name="panels" widget="object_list">',
    '    <block type="panel" title="${h/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'));

  it('resolves to the delimiter level at the current depth', () => {
    const md2 = ['<block type="accordion">', '', '## Two A', '', '### deeper', '', '## Two B', '', 'x', '', '</block>'].join('\n');
    const b2 = matchBlocks(protos, md2, 2)[0]; // depth 2 -> split at h2
    expect(b2.panels.map((p) => p.title)).toEqual(['Two A', 'Two B']);
    expect(b2.panels[0].blocks[0].value[0].type).toBe('h3'); // ### stays as content

    const md3 = ['<block type="accordion">', '', '### Three A', '', '### Three B', '', '</block>'].join('\n');
    const b3 = matchBlocks(protos, md3, 3)[0]; // depth 3 -> same ${h} now splits at h3
    expect(b3.panels.map((p) => p.title)).toEqual(['Three A', 'Three B']);
  });
});

describe('relative depth round-trip', () => {
  it('emits ${h} at the current depth and decodes back', () => {
    const protos = parsePrototypes([
      '<block type="slate" value="${p|h*/slate}" />',
      '<block type="accordion">',
      '  <region name="panels" widget="object_list">',
      '    <block type="panel" title="${h/text}" />',
      '  </region>',
      '</block>',
    ].join('\n'));
    const block = { '@type': 'accordion', panels: [
      { title: 'One', blocks: [{ '@type': 'slate', value: [{ type: 'p', children: [{ text: 'body' }] }] }] },
    ] };
    const md = emitBlocks(protos, [block]);
    expect(md).toContain('## One'); // depth 2 -> h2
    expect(matchBlocks(protos, md)).toEqual([block]);
  });
});

describe('grid headline as heading (container scalar-ref)', () => {
  const protos = parsePrototypes([
    '<block type="slate" value="${p|h*/slate}" />',
    '<block type="gridBlock" headline="${h/text}">',
    '  <region name="blocks" widget="blocks_layout">',
    '    <block type="teaser" title="${h/text}" description="${p/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'));

  it('reads a leading heading as headline, cards one deeper, round-trips', () => {
    const block = { '@type': 'gridBlock', headline: 'The Grid', blocks: [
      { '@type': 'teaser', title: 'Card One', description: 'Copy.' },
      { '@type': 'teaser', title: 'Card Two', description: 'More.' },
    ] };
    const md = emitBlocks(protos, [block]);
    expect(md).toContain('## The Grid');
    expect(md).toContain('### Card One');
    expect(matchBlocks(protos, md)).toEqual([block]);
  });

  it('a grid with no headline emits none and round-trips', () => {
    const block = { '@type': 'gridBlock', blocks: [{ '@type': 'teaser', title: 'Only', description: 'x' }] };
    const md = emitBlocks(protos, [block]);
    expect(md).not.toMatch(/^## /m); // no h2 headline line
    expect(matchBlocks(protos, md)).toEqual([block]);
  });
});

describe('local overrides', () => {
  const acc = parsePrototypes([
    '<block type="slate" value="${p|h*/slate}" />',
    '<block type="accordion" right_arrows=true>',
    '  <region name="panels" widget="object_list">',
    '    <block type="panel" title="${h/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'));

  it('attribute override: an instance attr beats the prototype default', () => {
    const md = ['<block type="accordion" right_arrows=false>', '', '## A', '', 'x', '', '</block>'].join('\n');
    expect(matchBlocks(acc, md)[0].right_arrows).toBe(false); // proto default is true
  });

  it('light tag: a named-type tag with a clean body decodes via its prototype', () => {
    const protos = parsePrototypes('<block type="slate" value="${p/slate}" />');
    expect(matchBlocks(protos, '<block type="slate">\n\nHello.\n\n</block>'))
      .toEqual([{ '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Hello.' }] }] }]);
  });

  it('inline <region>: an explicit region tag sets that region content', () => {
    const md = [
      '<block type="accordion">', '',
      '<region name="panels">', '',
      '## First', '', 'one', '',
      '## Second', '', 'two', '',
      '</region>', '',
      '</block>',
    ].join('\n');
    expect(matchBlocks(acc, md)[0].panels.map((p) => p.title)).toEqual(['First', 'Second']);
  });
});

describe('<fields> tag', () => {
  const protos = parsePrototypes('<block type="slate" value="${p/slate}" />');

  it('hoists an uncovered field, keeping the body clean, and round-trips', () => {
    const block = { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Prose.' }] }], styles: { align: 'left' } };
    const md = emitBlocks(protos, [block]);
    expect(md).toContain('Prose.');       // body stays clean markdown
    expect(md).toContain('<fields');      // styles hoisted, not tier-3
    expect(md).not.toMatch(/data='[^']*"value"/); // value is NOT dumped in data
    expect(matchBlocks(protos, md)).toEqual([block]);
  });

  it('decodes multiple fields from one <fields> tag', () => {
    const md = '<block type="slate">\n\nHi.\n\n<fields fixed=true data-json=\'{"styles":{"align":"left"}}\' />\n\n</block>';
    expect(matchBlocks(protos, md)).toEqual([
      { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Hi.' }] }], fixed: true, styles: { align: 'left' } },
    ]);
  });
});

describe('<fields> enclosing (propagate fields to every wrapped block)', () => {
  const protos = parsePrototypes([
    '<block type="slate" value="${p/slate}" />',
    '<block type="separator" _="${hr}" />',
  ].join('\n'));

  it('stamps a wrapper\'s fields onto every enclosed block as defaults', () => {
    const md = [
      '<fields slotId="rendering" templateInstanceId="ti-1">', '',
      'First.', '',
      'Second.', '',
      '</fields>',
    ].join('\n');
    expect(matchBlocks(protos, md)).toEqual([
      { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'First.' }] }], slotId: 'rendering', templateInstanceId: 'ti-1' },
      { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Second.' }] }], slotId: 'rendering', templateInstanceId: 'ti-1' },
    ]);
  });

  it('lets an enclosed block override an inherited field (block wins)', () => {
    const md = [
      '<fields slotId="rendering">', '',
      '<block type="slate" slotId="schema">', '', 'Body.', '', '</block>', '',
      '</fields>',
    ].join('\n');
    expect(matchBlocks(protos, md)[0].slotId).toBe('schema');
  });

  it('merges nested wrappers — outer fills what inner did not set', () => {
    const md = [
      '<fields templateInstanceId="ti-1">', '',
      '<fields slotId="rendering">', '',
      'Body.', '',
      '</fields>', '',
      '</fields>',
    ].join('\n');
    expect(matchBlocks(protos, md)[0]).toMatchObject({
      '@type': 'slate', templateInstanceId: 'ti-1', slotId: 'rendering',
    });
  });
});

describe('emit: hoist shared fields into <fields> wrappers', () => {
  const protos = parsePrototypes('<block type="slate" value="${p/slate}" />');
  const keyed = {
    blocks: {
      a: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'One.' }] }], templateInstanceId: 'ti', slotId: 'schema' },
      b: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Two.' }] }], templateInstanceId: 'ti', slotId: 'rendering' },
      c: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Three.' }] }], templateInstanceId: 'ti', slotId: 'rendering' },
    },
    blocks_layout: { items: ['a', 'b', 'c'] },
  };

  it('factors what all blocks share into one outer wrapper (not repeated per block)', () => {
    const { markdown } = emitPage(protos, keyed);
    expect((markdown.match(/templateInstanceId=/g) || []).length).toBe(1); // hoisted once
    expect(markdown).toMatch(/<fields[^>]*slotId="rendering"/);            // b,c share a run
  });

  it('round-trips the hoisted page back to the same blocks', () => {
    const { markdown } = emitPage(protos, keyed);
    expect(matchBlocks(protos, markdown)).toEqual([
      { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'One.' }] }], templateInstanceId: 'ti', slotId: 'schema' },
      { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Two.' }] }], templateInstanceId: 'ti', slotId: 'rendering' },
      { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Three.' }] }], templateInstanceId: 'ti', slotId: 'rendering' },
    ]);
  });
});

describe('link widget (/link)', () => {
  const protos = [
    ...parsePrototypes('<block type="slate" value="${p,h*,ul,ol,blockquote/slate}" />'),
    ...parsePrototypes('<block type="button" title="${p/text}" href="${p/link}" />', { explicit: true }),
  ];

  it('decodes a button light tag into title + object-browser href', () => {
    const md = '<block type="button">\n\n[Docs](/docs)\n\n</block>';
    expect(matchBlocks(protos, md)).toEqual([
      { '@type': 'button', title: 'Docs', href: [{ '@id': '/docs' }] },
    ]);
  });

  it('leaves a bare lone link as a slate paragraph, not a button', () => {
    expect(matchBlocks(protos, '[Docs](/docs)')[0]['@type']).toBe('slate');
  });

  it('emits a button as a light tag (explicit), the link clean, not tier-3', () => {
    const block = { '@type': 'button', title: 'Docs', href: [{ '@id': '/docs' }] };
    const md = emitBlocks(protos, [block]);
    expect(md).toContain('<block type="button">');
    expect(md).toContain('[Docs](/docs)');
    expect(md).not.toContain('data=');
    expect(matchBlocks(protos, md)).toEqual([block]);
  });

  it('reads the href from a link inside a heading (teaser)', () => {
    const teaser = parsePrototypes(
      '<block type="teaser" title="${h/text}" href="${h/link}" description="${p/text}" />');
    const block = {
      '@type': 'teaser', title: 'Headline', href: [{ '@id': '/page' }], description: 'Lorem.',
    };
    const md = emitBlocks(teaser, [block]);
    expect(md).toContain('[Headline](/page)');
    expect(matchBlocks(teaser, md)).toEqual([block]);
  });
});



describe('required elements — a ref must resolve for the prototype to match', () => {
  const protos = parsePrototypes([
    '<block type="slate" value="${p|h*|ul|ol|blockquote/slate}" />',
    '<block type="teaser" title="${h/text}" href="${h/link}" description="${p/text}" />',
  ].join('\n'));

  it('does not grab a linkless heading + paragraph as a teaser (href is required)', () => {
    expect(matchBlocks(protos, '## Heading\n\nLorem.').map((b) => b['@type']))
      .toEqual(['slate', 'slate']);
  });

  it('matches a teaser only when the heading actually has a link', () => {
    const [t] = matchBlocks(protos, '## [Read more](/page)\n\nLorem.');
    expect(t['@type']).toBe('teaser');
    expect(t.href).toEqual([{ '@id': '/page' }]);
  });
});

describe('adjacent bare-text leaves are one leaf (Slate normalisation)', () => {
  it('accepts split text leaves as clean, since markdown merges them', () => {
    const protos = parsePrototypes('<block type="slate" value="${p/slate}" />');
    // Slate can store "Hello world." as two adjacent leaves (an editing artifact);
    // markdown merges them, and the comparison treats the two forms as equal.
    const block = { '@type': 'slate', value: [{ type: 'p', children: [
      { text: 'Hello ' }, { text: 'world.' },
    ] }] };
    const md = emitBlocks(protos, [block]);
    expect(md).not.toContain('data='); // clean, not tier-3
    expect(md).toContain('Hello world.');
  });
});

describe('explicit prototypes — require the tag, never match bare', () => {
  const protos = [
    ...parsePrototypes('<block type="slate" value="${p,h*,ul,ol,blockquote/slate}" />'),
    ...parsePrototypes('<block type="teaser" title="${h/text}" href="${h/link}" description="${p/text}" />', { explicit: true }),
  ];

  it('does not grab a bare heading-link + prose (stays two slates)', () => {
    expect(matchBlocks(protos, '## [See docs](/docs)\n\nProse.').map((b) => b['@type']))
      .toEqual(['slate', 'slate']);
  });

  it('matches only via an explicit <block type="teaser"> tag', () => {
    const md = '<block type="teaser">\n\n## [See docs](/docs)\n\nProse.\n\n</block>';
    const [t] = matchBlocks(protos, md);
    expect(t['@type']).toBe('teaser');
    expect(t.href).toEqual([{ '@id': '/docs' }]);
  });
});

describe('format leaning: comma delimiter, data-json, optional assignment type', () => {
  it('comma is the node-set delimiter, matching like pipe (h* wildcard kept)', () => {
    const protos = parsePrototypes('<block type="slate" value="${p,h*,ul,ol,blockquote/slate}" />');
    expect(matchBlocks(protos, '## Head')).toEqual([{ '@type': 'slate', value: [{ type: 'h2', children: [{ text: 'Head' }] }] }]);
    expect(matchBlocks(protos, 'Para.')).toEqual([{ '@type': 'slate', value: [{ type: 'p', children: [{ text: 'Para.' }] }] }]);
  });

  it('a tier-3 fallback uses data-json, leaving a real `data` field intact', () => {
    const protos = parsePrototypes('<block type="slate" value="${p/slate}" />');
    const md = `<block type="teaser" data-json='{"title":"T","data":{"x":1}}' />`;
    expect(matchBlocks(protos, md)).toEqual([{ '@type': 'teaser', title: 'T', data: { x: 1 } }]);
  });

  it('keyBlocks accepts an assignment carrying only a uid (no type)', () => {
    const blocks = [{ '@type': 'slate', value: [{ type: 'p', children: [{ text: 'x' }] }] }];
    const { blocks: keyed, blocks_layout } = keyBlocks(blocks, [{ uid: 'u1' }]);
    expect(blocks_layout.items).toEqual(['u1']);
    expect(keyed.u1['@type']).toBe('slate');
  });

  it('emitPage no longer writes type into assignments', () => {
    const keyed = { blocks: { u1: { '@type': 'slate', value: [{ type: 'p', children: [{ text: 'hi' }] }] } }, blocks_layout: { items: ['u1'] } };
    const protos = parsePrototypes('<block type="slate" value="${p,h*/slate}" />');
    const { assignments } = emitPage(protos, keyed);
    expect(assignments).toEqual([{ uid: 'u1' }]);
  });
});

describe('greedy container — bare codeExample, no wrapper', () => {
  const protos = parsePrototypes([
    '<block type="slate" value="${p,h*/slate}" />',
    '<block type="codeExample">',
    '  <region name="tabs" widget="object_list">',
    '    <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />',
    '  </region>',
    '</block>',
  ].join('\n'));

  it('greedily consumes consecutive ### + fence panels as one codeExample', () => {
    const md = ['### Nuxt', '```vue', '<template/>', '```', '', '### Next', '```jsx', 'x', '```'].join('\n');
    const [block, ...rest] = matchBlocks(protos, md);
    expect(rest).toEqual([]);
    expect(block['@type']).toBe('codeExample');
    expect(block.tabs.map((t) => t.label)).toEqual(['Nuxt', 'Next']);
    expect(block.tabs.map((t) => t.language)).toEqual(['vue', 'jsx']);
    expect(block.tabs[0].code).toBe('<template/>');
  });

  it('stops at the first node that breaks the pattern (bare prose stays slate)', () => {
    const md = ['### Tab', '```js', 'a', '```', '', 'A paragraph.'].join('\n');
    const blocks = matchBlocks(protos, md);
    expect(blocks.map((b) => b['@type'])).toEqual(['codeExample', 'slate']);
    expect(blocks[1].value[0].type).toBe('p');
  });
});

describe('bold/italic paragraph kinds + optional refs', () => {
  it('captures an all-bold paragraph as a `strong` kind (leaf), round-tripping', () => {
    const protos = parsePrototypes('<block type="hero" headline="${h/text}" kicker="${strong/text}" />', { explicit: true });
    const md = '<block type="hero">\n\n## Title\n\n**Kick**\n\n</block>';
    const b = matchBlocks(protos, md);
    expect(b).toEqual([{ '@type': 'hero', headline: 'Title', kicker: 'Kick' }]);
    expect(matchBlocks(protos, emitBlocks(protos, b))).toEqual(b);
  });

  it('captures an all-italic paragraph as an `em` kind', () => {
    const protos = parsePrototypes('<block type="hero" headline="${h/text}" lead="${em/text}" />', { explicit: true });
    const md = '<block type="hero">\n\n## Title\n\n*Lead in*\n\n</block>';
    expect(matchBlocks(protos, md)).toEqual([{ '@type': 'hero', headline: 'Title', lead: 'Lead in' }]);
  });

  it('a paragraph with only SOME bold is NOT a strong kind (stays slate/p)', () => {
    const protos = parsePrototypes('<block type="hero" kicker="${strong/text}" />', { explicit: true });
    // "a **bold** word" is a normal paragraph -> no lone strong -> hero cannot match
    expect(() => matchBlocks(protos, '<block type="hero">\n\na **bold** word\n\n</block>')).toThrow();
  });

  it('an optional item ref (`${strong?/text}`) is skipped when its node is absent', () => {
    const protos = parsePrototypes([
      '<block type="slider">',
      '  <region name="slides" widget="object_list">',
      '    <block type="slide" title="${h/text}" kicker="${strong?/text}" />',
      '  </region>',
      '</block>',
    ].join('\n'), { explicit: true });
    const md = ['<block type="slider">', '', '## One', '', '**Kick**', '', '## Two', '', '</block>'].join('\n');
    const [slider] = matchBlocks(protos, md);
    expect(slider.slides.map((s) => [s.title, s.kicker])).toEqual([['One', 'Kick'], ['Two', undefined]]);
  });
});

describe('vocabulary: title-string + code meta parts', () => {
  it('captures an image title-string via ${img/title}, round-tripping', () => {
    const protos = parsePrototypes('<block type="figure" url="${img/src}" alt="${img/alt}" caption="${img/title}" />', { explicit: true });
    const md = '<block type="figure">\n\n![the alt](/x.png "the caption")\n\n</block>';
    const b = matchBlocks(protos, md);
    expect(b).toEqual([{ '@type': 'figure', url: '/x.png', alt: 'the alt', caption: 'the caption' }]);
    expect(matchBlocks(protos, emitBlocks(protos, b))).toEqual(b);
  });

  it('captures a link title-string via ${p/title}, round-tripping', () => {
    const protos = parsePrototypes('<block type="cta" label="${p/text}" href="${p/link}" tip="${p/title}" />', { explicit: true });
    const md = '<block type="cta">\n\n[click me](/go "the tooltip")\n\n</block>';
    const b = matchBlocks(protos, md);
    expect(b[0].tip).toBe('the tooltip');
    expect(matchBlocks(protos, emitBlocks(protos, b))).toEqual(b);
  });

  it('captures a code-fence info string via ${pre/meta}, round-tripping', () => {
    const protos = parsePrototypes('<block type="snippet" language="${pre/lang}" code="${pre/text}" opts="${pre/meta}" />', { explicit: true });
    const md = '<block type="snippet">\n\n```js highlight=1-3\ncode()\n```\n\n</block>';
    const b = matchBlocks(protos, md);
    expect(b[0]).toMatchObject({ language: 'js', opts: 'highlight=1-3', code: 'code()' });
    expect(matchBlocks(protos, emitBlocks(protos, b))).toEqual(b);
  });
});

describe('labelled section matching (${p[Heading]/part})', () => {
  const protos = [
    ...parsePrototypes('<block type="slate" value="${p,h*/slate}" />'),
    ...parsePrototypes([
    '<block type="page" summary="${p[Summary]/text}" intro="${p[Intro]/text}">',
    '  <region name="blocks" widget="blocks_layout">',
    '    <block type="slate" value="${p,h*/slate}" />',
    '  </region>',
    '</block>',
  ].join('\n'), { explicit: true })];

  it('captures the paragraph under a named heading, by label not position', () => {
    const md = [
      '<block type="page">', '',
      '## Intro', '', 'The intro paragraph.', '',
      '## Summary', '', 'The summary paragraph.', '',
      '</block>',
    ].join('\n');
    const [b] = matchBlocks(protos, md);
    expect(b.summary).toBe('The summary paragraph.');
    expect(b.intro).toBe('The intro paragraph.');
  });
});

describe('labelled section emit (round-trip)', () => {
  const protos = [
    ...parsePrototypes('<block type="slate" value="${p,h*/slate}" />'),
    ...parsePrototypes([
      '<block type="page" summary="${p[Summary]/text}" intro="${p[Intro]/text}">',
      '  <region name="blocks" widget="blocks_layout">',
      '    <block type="slate" value="${p,h*/slate}" />',
      '  </region>',
      '</block>',
    ].join('\n'), { explicit: true })];

  it('decode -> emit -> decode yields the same block (labelled sections)', () => {
    const md = [
      '<block type="page">', '',
      '## Intro', '', 'The intro paragraph.', '',
      '## Summary', '', 'The summary paragraph.', '',
      '</block>',
    ].join('\n');
    const [b] = matchBlocks(protos, md);
    const emitted = emitBlocks(protos, [b]);
    const [b2] = matchBlocks(protos, emitted);
    expect(b2).toEqual(b);
  });
});

describe('def-list term matching (${dd[Term]/part})', () => {
  const protos = [
    ...parsePrototypes('<block type="slate" value="${p,h*/slate}" />'),
    ...parsePrototypes([
      '<block type="eventMetadata" start="${dd[Start]/text}" location="${dd[Location]/text}">',
      '  <region name="blocks" widget="blocks_layout">',
      '    <block type="slate" value="${p,h*/slate}" />',
      '  </region>',
      '</block>',
    ].join('\n'), { explicit: true })];

  it('captures def-list values by term and round-trips', () => {
    const md = [
      '<block type="eventMetadata">', '',
      'Start', ': 2024-01-01', '',
      'Location', ': Berlin', '',
      '</block>',
    ].join('\n');
    const [b] = matchBlocks(protos, md);
    expect(b.start).toBe('2024-01-01');
    expect(b.location).toBe('Berlin');
    const [b2] = matchBlocks(protos, emitBlocks(protos, [b]));
    expect(b2).toEqual(b);
  });
});
