/**
 * The files block discovery leaves for the suites that read it.
 *
 * Discovery runs once, before the tests (see `playwright/global-setup`), and
 * writes what it found into one directory. The sanity suites and the coverage
 * reporter read it back from there, each in its own process, so the directory
 * is the one thing they all have to be told.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export const DISCOVERY_FILES = {
  /** Every block case: one per type and variation, plus content findings. */
  blocks: '.discovered-blocks.json',
  /** Example coverage, per frontend. */
  coverage: '.discovered-coverage.json',
  /** Every container region, paired with an example to empty it on. */
  emptyRegions: '.discovered-empty-regions.json',
  /** Containers that allow a listing, and how the two disagree. */
  listingContainerIssues: '.discovered-listing-container-issues.json',
} as const;

export type DiscoveryFile = keyof typeof DISCOVERY_FILES;

export const discoveryPath = (dir: string, which: DiscoveryFile): string =>
  path.resolve(dir, DISCOVERY_FILES[which]);

/** What discovery wrote, or null when it did not run. */
export function readDiscovery<T = any>(dir: string, which: DiscoveryFile): T[] | null {
  const file = discoveryPath(dir, which);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

/**
 * The block types the render contract leaves out.
 *
 * A suite's own fixtures can hold blocks that only its test frontend renders
 * (drag-and-drop conversion fixtures, listing variants with their own spec), so
 * they are no part of the contract every frontend keeps. The sanity suites and
 * the coverage reporter apply the same scope, so a type left out of one is left
 * out of all of them.
 */
export interface ContractScope {
  /** Block types left out by name. */
  excludeBlockTypes?: Iterable<string>;
  /** Block types left out by the start of their name. */
  excludeTypePrefixes?: Iterable<string>;
}

export function inContract(blockType: string | undefined, scope: ContractScope = {}): boolean {
  const type = blockType ?? '';
  const names = new Set(scope.excludeBlockTypes ?? []);
  if (names.has(type)) return false;
  return ![...(scope.excludeTypePrefixes ?? [])].some((prefix) => type.startsWith(prefix));
}
