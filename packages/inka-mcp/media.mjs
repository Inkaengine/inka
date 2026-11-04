/**
 * Files an agent stages for a page change (stage_media): an image, or any
 * other file, not on the site yet. The server keeps the bytes (codes.mjs) and gives the agent an id,
 * `media:<id>`, which it puts where an image or a file goes, as it would a
 * real item's URL. Each call that uses one hands the file to the editor
 * (__inkaAgent.holdFile), which holds it until the page is saved, and Save
 * uploads it beside the page. A preview hands the front end each file as a
 * data: URL.
 *
 * A file from a URL is fetched by this server, so the URL must be on the
 * public internet: every address it resolves to, each redirect's included, is
 * checked as it is connected to, so a name can't resolve to one address for
 * the check and another for the fetch.
 *
 * A file on the person's own computer (the stdio server only) must be inside a
 * folder they allowed, after every link in its path is followed.
 */
import { realpathSync, statSync } from 'node:fs';
import { realpath, stat, readFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative } from 'node:path';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';

/** What an agent's media id starts with; the rest is the id the store issued. */
export const MEDIA_PREFIX = 'media:';
const MEDIA_ID = /^media:[A-Za-z0-9_~%.-]+$/;
const REDIRECTS = 5;

/** A file that can't be added: the URL, its address, its type or its size. */
export class MediaRefused extends Error {}

/** `file` (`{ type, data }`, data base64) as a data: URL: how a preview hands a front end a file not on the site. */
export function dataUrlOf({ type, data }) {
  return `data:${type};base64,${data}`;
}

/** The media ids `value` holds, each once, in the order it holds them: only a whole value is one. */
export function mediaIn(value, found = new Set()) {
  if (typeof value === 'string') {
    if (MEDIA_ID.test(value)) found.add(value);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) mediaIn(v, found);
  }
  return found;
}

/** `value` with each string `swaps` has (a Map) swapped for what it maps to; `value` is not changed. */
export function withMedia(value, swaps) {
  if (typeof value === 'string') return swaps.has(value) ? swaps.get(value) : value;
  if (Array.isArray(value)) return value.map((v) => withMedia(v, swaps));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withMedia(v, swaps)]));
  }
  return value;
}

// Every range that isn't the public internet: this host, private networks,
// link-local (cloud metadata), carrier-grade NAT, documentation and reserved
// ranges, multicast. An IPv4-mapped IPv6 address is checked against these.
const NOT_PUBLIC = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) NOT_PUBLIC.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32]]) {
  NOT_PUBLIC.addSubnet(net, prefix, 'ipv6');
}

/** Is `address` (an IP address) on the public internet? */
export function isPublicAddress(address) {
  const family = isIP(address);
  if (!family) throw new Error(`not an IP address: ${JSON.stringify(address)}`);
  return !NOT_PUBLIC.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

const refusedAddress = (address) => new MediaRefused(`${address} is not on the public internet, so it can't be fetched from`);

/** dns.lookup, refusing an address `isAllowed` refuses: what a request connects to is what was checked. */
function checkedLookup(isAllowed) {
  return (hostname, options, callback) => dnsLookup(hostname, options, (error, address, family) => {
    if (error) return callback(error);
    const addresses = Array.isArray(address) ? address : [{ address, family }];
    const refused = addresses.find((a) => !isAllowed(a.address));
    if (refused) return callback(refusedAddress(refused.address));
    return callback(null, address, family);
  });
}

/** The response to a GET of `url` (a URL), connecting only where `isAllowed` allows. */
function get(url, isAllowed) {
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  // An IP address in the URL is connected to without a lookup: check it here.
  if (isIP(literal) && !isAllowed(literal)) return Promise.reject(refusedAddress(literal));
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(url, { lookup: checkedLookup(isAllowed), headers: { Accept: '*/*' } }, resolve);
    req.on('error', reject);
    req.end();
  });
}

/** The file name a Content-Disposition header gives, or null. */
function dispositionName(header) {
  const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header ?? '');
  return named ? decodeURIComponent(named[1]) : null;
}

/** The body of `res`, refused once it is larger than `maxBytes`. */
function bodyOf(res, url, maxBytes) {
  const tooBig = () => new MediaRefused(`${url} is larger than ${maxBytes} bytes, the most a file may be`);
  if (Number(res.headers['content-length']) > maxBytes) {
    res.destroy();
    return Promise.reject(tooBig());
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    res.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        res.destroy();
        reject(tooBig());
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  });
}

/**
 * The file at `url` (http or https), as `{ name, type, data }` (data base64),
 * following redirects. `isAllowed(address)` says whether an address may be
 * connected to (isPublicAddress); `maxBytes` is the most a file may be. Its
 * name is `name` if given, else the one the server gives, else the URL's last
 * segment.
 */
export async function fetchMedia(url, { maxBytes, isAllowed, name }) {
  if (!maxBytes) throw new Error('fetchMedia: maxBytes is required');
  if (!isAllowed) throw new Error('fetchMedia: isAllowed is required (isPublicAddress)');
  let at = new URL(url);
  for (let hops = 0; ; hops++) {
    if (!['http:', 'https:'].includes(at.protocol)) throw new MediaRefused(`a file is fetched over http or https, not ${at.protocol}`);
    const res = await get(at, isAllowed);
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      if (hops === REDIRECTS) throw new MediaRefused(`${url} gave too many redirects`);
      at = new URL(res.headers.location, at);
      continue;
    }
    if (res.statusCode !== 200) {
      res.resume();
      throw new MediaRefused(`${at} answered ${res.statusCode}`);
    }
    const type = res.headers['content-type']?.split(';')[0].trim();
    if (!type) {
      res.resume();
      throw new MediaRefused(`${at} gave no Content-Type, so what kind of file it is isn't known`);
    }
    const data = await bodyOf(res, at, maxBytes);
    const named = name ?? dispositionName(res.headers['content-disposition'])
      ?? decodeURIComponent(at.pathname.split('/').pop());
    if (!named) throw new MediaRefused(`${at} has no file name in it: give it a name`);
    return { name: named, type, data: data.toString('base64') };
  }
}

// What a file on disk is, by its extension: a disk gives no Content-Type.
const TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.avif': 'image/avif', '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv',
  '.doc': 'application/msword', '.xls': 'application/vnd.ms-excel', '.ppt': 'application/vnd.ms-powerpoint',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text', '.zip': 'application/zip',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

/** Is `path` (a real path) `folder` or inside it? */
const isInside = (folder, path) => {
  const rel = relative(folder, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/**
 * A reader of files inside `folders` (the folders the person allowed), each at
 * most `maxBytes`: `read(path, name?)` gives `{ name, type, data }` (data
 * base64). Each folder must be there when this is made.
 */
export function localFiles(folders, { maxBytes }) {
  if (!maxBytes) throw new Error('localFiles: maxBytes is required');
  const real = folders.map((folder) => {
    let at;
    try {
      at = realpathSync(folder);
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`localFiles: the folder ${folder} is not there`, { cause: error });
      throw error;
    }
    if (!statSync(at).isDirectory()) throw new Error(`localFiles: ${folder} is not a folder`);
    return at;
  });
  return async (path, name) => {
    if (!isAbsolute(path)) throw new MediaRefused(`${path} is not a whole path: give one starting at /`);
    let at;
    try {
      at = await realpath(path);
    } catch (error) {
      if (error.code === 'ENOENT') throw new MediaRefused(`there is no file at ${path}`);
      throw error;
    }
    if (!real.some((folder) => isInside(folder, at))) throw new MediaRefused(`${path} is not in a folder you allowed the assistant to read`);
    const found = await stat(at);
    if (!found.isFile()) throw new MediaRefused(`${path} is not a file`);
    if (found.size > maxBytes) throw new MediaRefused(`${path} is larger than ${maxBytes} bytes, the most a file may be`);
    const type = TYPES[extname(at).toLowerCase()];
    if (!type) throw new MediaRefused(`this server doesn't know what kind of file ${extname(at) || 'one with no extension'} is`);
    return { name: name ?? basename(path), type, data: (await readFile(at)).toString('base64') };
  };
}
