import { describe, it, expect } from 'vitest';
import { memoryLimit, poolSize, PAGE_BYTES, BASE_BYTES } from './poolSize.mjs';

const MB = 1024 * 1024;

/** A reader of the files `memoryLimit` looks at: `files` maps a path to its text; any other is absent. */
const reading = (files) => (path) => {
  if (!(path in files)) {
    const error = new Error(`ENOENT: ${path}`);
    error.code = 'ENOENT';
    throw error;
  }
  return files[path];
};

describe('memoryLimit', () => {
  it("is a container's cgroup limit (v2)", () => {
    expect(memoryLimit({ read: reading({ '/sys/fs/cgroup/memory.max': `${2048 * MB}\n` }), total: 64 * 1024 * MB })).toBe(2048 * MB);
  });

  it("is a container's cgroup limit (v1)", () => {
    expect(memoryLimit({ read: reading({ '/sys/fs/cgroup/memory/memory.limit_in_bytes': `${512 * MB}\n` }), total: 64 * 1024 * MB })).toBe(512 * MB);
  });

  it("is the machine's memory when the cgroup sets no limit", () => {
    expect(memoryLimit({ read: reading({ '/sys/fs/cgroup/memory.max': 'max\n' }), total: 1024 * MB })).toBe(1024 * MB);
    // cgroup v1 writes "no limit" as a number near the top of a 64-bit range.
    expect(memoryLimit({ read: reading({ '/sys/fs/cgroup/memory/memory.limit_in_bytes': '9223372036854771712\n' }), total: 1024 * MB })).toBe(1024 * MB);
  });

  it("is the machine's memory where there is no cgroup (a VM, or not Linux)", () => {
    expect(memoryLimit({ read: reading({}), total: 1024 * MB })).toBe(1024 * MB);
  });

  it('lets any other error reading the cgroup through', () => {
    const read = () => { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; };
    expect(() => memoryLimit({ read, total: 1024 * MB })).toThrow('EACCES');
  });
});

describe('poolSize', () => {
  it('is as many editor pages as fit beside the browser and the server', () => {
    expect(poolSize({ memory: BASE_BYTES + 2 * PAGE_BYTES, atMost: 10 })).toEqual({ size: 2, fits: 2 });
    expect(poolSize({ memory: BASE_BYTES + 2 * PAGE_BYTES - 1, atMost: 10 })).toEqual({ size: 1, fits: 1 });
  });

  it('is no more than INKA_MCP_POOL_SIZE allows', () => {
    expect(poolSize({ memory: 64 * 1024 * MB, atMost: 3 })).toEqual({ size: 3, fits: expect.any(Number) });
  });

  it('a 1 GB machine fits two pages', () => {
    expect(poolSize({ memory: 1024 * MB, atMost: 10 }).size).toBe(2);
  });

  it('refuses a machine without room for one page', () => {
    expect(() => poolSize({ memory: BASE_BYTES + PAGE_BYTES - 1, atMost: 10 })).toThrow(/room for one editor page/);
  });

  it('refuses a cap below one', () => {
    expect(() => poolSize({ memory: 1024 * MB, atMost: 0 })).toThrow(/INKA_MCP_POOL_SIZE/);
  });
});
