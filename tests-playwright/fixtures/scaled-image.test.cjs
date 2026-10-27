/**
 * Run: node --test tests-playwright/fixtures/scaled-image.test.cjs
 *
 * The round trip matters more than any single function: a PNG we generate must
 * be readable by the same header parser, because the whole point is that a
 * decode downstream reports the width the frontend asked for.
 */
const test = require('node:test');
const assert = require('node:assert');
const { imageSize, scaledSize, pngOfSize } = require('./scaled-image.cjs');

test('a generated PNG reports the size it was made at', () => {
  for (const [w, h] of [[400, 266], [1, 1], [2400, 1600], [37, 9]]) {
    const png = pngOfSize(w, h);
    assert.deepEqual(imageSize(png), { width: w, height: h }, `${w}x${h}`);
  }
});

test('the PNG is structurally valid', () => {
  const png = pngOfSize(16, 8);
  assert.equal(png.readUInt32BE(0), 0x89504e47, 'PNG signature');
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.ok(png.includes(Buffer.from('IDAT', 'ascii')), 'has pixel data');
  assert.equal(png.subarray(png.length - 8, png.length - 4).toString('ascii'), 'IEND');
});

test('JPEG dimensions are read from the SOF marker', () => {
  // Minimal JPEG: SOI, an APP0 segment to skip, then SOF0 carrying 800x600.
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]),             // APP0, len 4
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20]), // SOF0 600x800
  ]);
  assert.deepEqual(imageSize(jpeg), { width: 800, height: 600 });
});

test('a DHT marker is not mistaken for a frame header', () => {
  // 0xc4 sits inside the SOF range but is a Huffman table. Reading dimensions
  // from it yields confident nonsense.
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xc4, 0x00, 0x06, 0x00, 0x11, 0x22, 0x33]),  // DHT, skip it
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90]), // SOF0 400x300
  ]);
  assert.deepEqual(imageSize(jpeg), { width: 400, height: 300 });
});

test('non-raster and junk yield null, never a guess', () => {
  for (const b of [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="99"/>'),
    Buffer.alloc(4),
    Buffer.from('not an image at all, really quite long though'),
    null,
    'a string',
  ]) {
    assert.equal(imageSize(b), null);
  }
});

test('scales keep the aspect ratio', () => {
  const s = scaledSize({ width: 2400, height: 1600 }, 'preview');
  assert.equal(s.width, 400);
  assert.equal(s.height, 267, '1600 * 400/2400, rounded');
});

test('scales never upscale — Plone caps at the source', () => {
  // A 266px logo asked for `huge` (1600) must stay 266, which is why
  // large/huge/great collapse to one size on small images.
  const src = { width: 266, height: 136 };
  for (const name of ['large', 'huge', 'great']) {
    assert.deepEqual(scaledSize(src, name), src, name);
  }
});

test('an unknown scale name is not invented', () => {
  assert.equal(scaledSize({ width: 800, height: 600 }, 'enormous'), null);
  assert.equal(scaledSize(null, 'preview'), null);
});

test('height never rounds to zero', () => {
  // A very wide, very short source could round its height away entirely.
  const s = scaledSize({ width: 4000, height: 3 }, 'icon');
  assert.equal(s.width, 32);
  assert.ok(s.height >= 1, `height was ${s.height}`);
});
