/**
 * Discovery's content-integrity check is judged with the frontend's schemas,
 * the page's included. A layout the page schema forces across a region (a site
 * footer, kept as one document every page shows) is named in that schema's
 * `allowedLayouts` and in no page's blocks, so without the page schema the
 * check reads the footer as a template nothing uses.
 */
import { describe, test, expect } from 'vitest';
import { checkIntegrity } from '@inka/content-validator';
import { integritySchemas } from './discover-blocks.cjs';

const footer = {
  rel: 'templates/site-footer',
  data: {
    '@id': 'http://localhost:8888/templates/site-footer',
    '@type': 'Document',
    id: 'site-footer',
    UID: 'footer-uid',
    blocks: { f: { '@type': 'slate', slotId: 'footer', fixed: true } },
    blocks_layout: { items: ['f'] },
  },
};
// A page that stores none of the footer's blocks: it gets them only by the
// page schema forcing the layout.
const page = {
  rel: 'about',
  data: {
    '@id': 'http://localhost:8888/about',
    '@type': 'Document',
    id: 'about',
    UID: 'about-uid',
    blocks: { t: { '@type': 'slate' } },
    blocks_layout: { items: ['t'] },
  },
};
const blocksConfig = { slate: { blockSchema: { properties: {} } } };
const pageSchema = {
  properties: {
    items: { widget: 'blocks_layout' },
    footer: { widget: 'blocks_layout', allowedLayouts: ['/templates/site-footer'] },
  },
};
const unused = (schemas) =>
  checkIntegrity([footer, page], { schemasFor: () => schemas }).errors.filter((e) =>
    e.includes('nothing uses it as a template'),
  );

describe('the schemas discovery judges content integrity with', () => {
  test('carry the page schema, so a layout it forces is a template in use', () => {
    expect(unused(integritySchemas(blocksConfig, pageSchema))).toEqual([]);
  });

  test('still report a template nothing uses', () => {
    const noFooter = { properties: { items: { widget: 'blocks_layout' } } };
    expect(unused(integritySchemas(blocksConfig, noFooter))).toHaveLength(1);
  });

  test('leave the blocks config they are given as it was', () => {
    integritySchemas(blocksConfig, pageSchema);
    expect(Object.keys(blocksConfig)).toEqual(['slate']);
  });
});
