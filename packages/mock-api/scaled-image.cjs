/**
 * Serve image scales at the RIGHT DIMENSIONS without an image library.
 *
 * The mock used to return the same bytes for every scale URL — its own comment
 * said so: "No actual resizing happens; the @@images endpoint serves the same
 * bytes at any scale." That is fine for checks that only care whether an image
 * loads, and fatal for any check that measures how big it is: a frontend that
 * correctly requests `@@images/image/preview` gets the 2400px original back,
 * and looks exactly like one that asked for the original.
 *
 * We do not need the real picture, only honest dimensions. So: read the source
 * size from the file header, work out what Plone would have produced, and
 * synthesise a blank PNG of exactly that size. A decode then reports the width
 * the frontend actually asked for.
 *
 * Capped at the source, like Plone: asking for `huge` on a 266px image yields
 * 266px, which is why `large`/`huge`/`great` collapse to one size on small
 * images rather than inventing pixels.
 */
const zlib = require('node:zlib');

/** plone.allowed_sizes defaults. Keep aligned with the mock's scale tables. */
const SCALE_WIDTHS = {
  icon: 32, tile: 64, thumb: 128, mini: 200, preview: 400,
  teaser: 600, large: 800, larger: 1000, great: 1200, huge: 1600,
};

/**
 * Intrinsic size from a PNG or JPEG header. Returns null for anything else —
 * SVG especially, which has no raster size and which Plone serves as the
 * original at every scale.
 */
function imageSize(buf) {
  // Length is checked PER FORMAT, not once up front. A single floor sized for
  // PNG's 24-byte IHDR silently rejected JPEGs shorter than that and returned
  // null as if they were unreadable.
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;

  // PNG: 8-byte signature, then IHDR with width/height as big-endian uint32.
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // JPEG: walk the segment chain to a Start-Of-Frame marker, which carries the
  // dimensions. SOF0/1/2/3, 5-7, 9-11, 13-15 — but NOT DHT/JPG/DAC (c4/c8/cc).
  if (buf.readUInt16BE(0) === 0xffd8) {
    let off = 2;
    // `off + 8 <` not `off + 9 <`: the dimensions end AT off+8, so a SOF
    // marker sitting at the very end of a minimal JPEG must still be readable.
    while (off + 8 < buf.length) {
      if (buf[off] !== 0xff) { off += 1; continue; }
      const marker = buf[off + 1];
      const len = buf.readUInt16BE(off + 2);
      const isSOF = marker >= 0xc0 && marker <= 0xcf
        && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSOF) {
        return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
      }
      off += 2 + len;
    }
  }
  return null;
}

/** What Plone would produce for `scaleName` from a `source` of this size. */
function scaledSize(source, scaleName) {
  const want = SCALE_WIDTHS[scaleName];
  if (!source || !want) return null;
  // Never upscale: Plone caps every scale at the source.
  const width = Math.min(want, source.width);
  if (width === source.width) return { ...source };
  return {
    width,
    height: Math.max(1, Math.round(source.height * (width / source.width))),
  };
}

/**
 * A blank PNG of exactly `width` x `height`.
 *
 * Hand-rolled because the point is dimensions, not pixels, and pulling an image
 * library into the fixtures for a grey rectangle would be a poor trade. Three
 * chunks: IHDR (size), IDAT (zlib-deflated scanlines, each prefixed with a
 * filter byte), IEND.
 */
function pngOfSize(width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;        // 8 bits per channel
  ihdr[9] = 2;        // truecolour RGB
  // 10-12: deflate / adaptive filtering / no interlace, all zero.

  // One filter byte (0 = None) then 3 bytes per pixel, per row.
  const row = Buffer.alloc(1 + width * 3, 0x80);
  row[0] = 0;
  const raw = Buffer.concat(Array.from({ length: height }, () => row));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

module.exports = { SCALE_WIDTHS, imageSize, scaledSize, pngOfSize };
