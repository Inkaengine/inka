import { Bridge } from './hydra.src.js';

/**
 * An image the admin holds until the page is saved (a front end that sets
 * `deferImageUploads`). The page names it by a short reference, and the admin
 * sends its file once (PENDING_IMAGE), which hydra holds as a blob: URL. The
 * renderer is handed that URL in place of the reference; hydra's own state,
 * and every FORM_DATA, keep the reference, so a keystroke costs what it did.
 */
const PICTURE = 'blob:http://frontend.test/0b6f7c1e-9d4a-4c55-8a51-2f0f5b1d7e21';
const SCHEMA = { properties: { url: { widget: 'image' }, heading: { type: 'string' } } };

function bridgeWith(block) {
  const formData = { blocks: { b1: { '@type': 'image', ...block } } };
  return Object.assign(Object.create(Bridge.prototype), {
    formData,
    blockPathMap: { b1: { path: ['blocks', 'b1'] } },
    getBlockSchema: () => SCHEMA,
    getBlockData: () => formData.blocks.b1,
    getFieldType: () => 'string',
    _editableFieldsOnCanvas: () => [],
  });
}

describe('pending images', () => {
  test('the renderer gets the picture where the page names a held image', () => {
    const bridge = bridgeWith({ url: 'inka-pending:a1' });
    bridge.holdPendingImage('inka-pending:a1', PICTURE);
    expect(bridge._projectForRender(bridge.formData).blocks.b1.url).toBe(PICTURE);
    // Only the renderer's copy: state keeps the reference.
    expect(bridge.formData.blocks.b1.url).toBe('inka-pending:a1');
  });

  test('a held image named as an object, [{ "@id" }], is swapped too', () => {
    const bridge = bridgeWith({ url: [{ '@id': 'inka-pending:a1', title: 'Shot' }] });
    bridge.holdPendingImage('inka-pending:a1', PICTURE);
    expect(bridge._projectForRender(bridge.formData).blocks.b1.url).toEqual([{ '@id': PICTURE, title: 'Shot' }]);
  });

  test('a page with no held image is handed over as it is', () => {
    const bridge = bridgeWith({ url: '/images/a', heading: 'inka-pending: is only text here' });
    bridge.holdPendingImage('inka-pending:a1', PICTURE);
    expect(bridge._projectForRender(bridge.formData)).toBe(bridge.formData);
  });

  test('a reference the admin has not sent is left as it is', () => {
    const bridge = bridgeWith({ url: 'inka-pending:unknown' });
    expect(bridge._projectForRender(bridge.formData).blocks.b1.url).toBe('inka-pending:unknown');
  });
});
