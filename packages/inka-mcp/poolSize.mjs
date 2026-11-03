/**
 * How many editor pages the hosted server's pool holds: as many as fit in its
 * memory beside the browser and the server itself, and no more than
 * INKA_MCP_POOL_SIZE.
 *
 * Measured on the hosted server itself (Linux, a 1 GB Fly machine, which shows
 * 965 MB): with one editor page loaded and parked the machine used 428 MB, and
 * while that page rendered page after page (the editor and a visitor's preview
 * open at once) at most 528 MB, everything included: the system, the Node
 * server (~150 MB) and the browser. The figures below are rounded up from
 * those, so a pool that fits doesn't run its machine out of memory. (The same
 * measurement on macOS reads far higher, 250–315 MB a page; its memory is
 * counted differently, so it isn't what a Linux machine needs.)
 */
import { readFileSync } from 'node:fs';
import { totalmem } from 'node:os';

const MB = 1024 * 1024;
/** One editor page at its largest: a browser context with the editor and its front end open. */
export const PAGE_BYTES = 300 * MB;
/** The browser with no pages, and the server. */
export const BASE_BYTES = 250 * MB;

// Where a container's memory limit is written: cgroup v2, then v1.
const CGROUP_LIMITS = ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes'];

/**
 * The memory this server may use: its container's cgroup limit, where one is
 * set, else the machine's memory (a VM, or a host with no cgroup). `read` and
 * `total` are the file reader and the machine's memory, given for tests.
 */
export function memoryLimit({ read = (path) => readFileSync(path, 'utf8'), total = totalmem() } = {}) {
  for (const path of CGROUP_LIMITS) {
    let text;
    try {
      text = read(path);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const value = text.trim();
    // "max" (v2), or a number past the machine's memory (v1's "no limit"), sets none.
    return value === 'max' ? total : Math.min(Number(value), total);
  }
  return total;
}

/**
 * The pool's size for `memory` bytes, at most `atMost` (INKA_MCP_POOL_SIZE):
 * { size, fits }, where `fits` is how many the memory holds.
 */
export function poolSize({ memory, atMost }) {
  if (!(Number.isInteger(atMost) && atMost >= 1)) throw new Error(`INKA_MCP_POOL_SIZE must be a whole number of at least 1 (got ${atMost})`);
  const fits = Math.floor((memory - BASE_BYTES) / PAGE_BYTES);
  if (fits < 1) {
    throw new Error(`${Math.round(memory / MB)} MB has no room for one editor page: it needs ${Math.round((BASE_BYTES + PAGE_BYTES) / MB)} MB`);
  }
  return { size: Math.min(fits, atMost), fits };
}
