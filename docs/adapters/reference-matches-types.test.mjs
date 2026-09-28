import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');

const GUIDE = path.join(HERE, 'index.md');
const TYPES = path.join(REPO, 'packages/hydra-types/index.d.ts');

/**
 * The union members of `export type <name> = | 'a' | 'b' …`.
 *
 * Line-based on purpose: the members are separated by long doc comments that
 * contain semicolons and quotes, so anything that looks for the closing `;` or
 * matches quotes across the whole block reads a truncated list — which is how a
 * first attempt at this check "passed" while seeing four of thirty-four intents.
 */
function unionMembers(source, name) {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`export type ${name} =`));
  if (start < 0) throw new Error(`No 'export type ${name}' in hydra-types`);
  const members = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const member = line.match(/^\s*\|\s*'([^']+)'/);
    if (member) {
      members.push(member[1]);
      continue;
    }
    // Doc comments and blank lines sit between members; anything else ends it.
    if (/^\s*(\/\*\*|\*|\/\/)/.test(line) || line.trim() === '') continue;
    break;
  }
  return members;
}

/** Every `backticked` token inside one of the guide's reference sections. */
function documented(guide, heading, nextHeading) {
  const from = guide.indexOf(`### ${heading}`);
  if (from < 0) throw new Error(`The guide has no "### ${heading}" section`);
  const to = nextHeading
    ? guide.indexOf(`### ${nextHeading}`, from)
    : guide.length;
  const section = guide.slice(from, to < 0 ? guide.length : to);
  return [...section.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

/**
 * The adapter guide's reference is what someone writing an adapter works from.
 * It was hand-maintained, and by the time this test was written it had drifted
 * in BOTH directions: eight intents existed and were undocumented
 * (content.sort, content.copy, site.get and the five translations.*), while the
 * types were missing two capabilities the Plone adapter declares and the admin
 * reads (http-passthrough, expand-native).
 *
 * Neither list is generated — the markdown is the source of the published docs,
 * so it stays authored — but they may not disagree.
 */
describe('the adapter guide documents exactly what the types declare', () => {
  const guide = fs.readFileSync(GUIDE, 'utf8');
  const types = fs.readFileSync(TYPES, 'utf8');

  it('lists every intent, and no intent that does not exist', () => {
    const declared = unionMembers(types, 'Intent');
    expect(declared.length).toBeGreaterThan(20);
    const listed = documented(guide, 'Intents', 'Capabilities');

    const undocumented = declared.filter((i) => !listed.includes(i));
    const invented = listed.filter((i) => !declared.includes(i));
    expect(
      { undocumented, invented },
      'add the intent to docs/adapters/index.md, or remove it from the guide',
    ).toEqual({ undocumented: [], invented: [] });
  });

  it('lists every capability, and no capability that does not exist', () => {
    const declared = unionMembers(types, 'Capability');
    expect(declared.length).toBeGreaterThan(10);
    const listed = documented(guide, 'Capabilities', null);

    const undocumented = declared.filter((c) => !listed.includes(c));
    const invented = listed.filter((c) => !declared.includes(c));
    expect({ undocumented, invented }).toEqual({
      undocumented: [],
      invented: [],
    });
  });

  it('declares every capability the shipped adapters claim', () => {
    // The third direction of drift: an adapter can claim a string nobody
    // declared. http-passthrough and expand-native were exactly that — read by
    // BridgeApi and by the expander bundle, absent from the union, so nothing
    // caught the omission. The adapters are JS, so TypeScript cannot.
    const declared = new Set(unionMembers(types, 'Capability'));
    const claimed = new Set();
    for (const cms of ['plone', 'wordpress', 'drupal']) {
      const src = fs.readFileSync(
        path.join(REPO, `packages/hydra-adapters-${cms}/index.js`),
        'utf8',
      );
      const block = src.slice(src.indexOf('capabilities: ['));
      const list = block.slice(0, block.indexOf('],'));
      for (const m of list.matchAll(/'([a-z-]+)'/g)) claimed.add(m[1]);
    }
    expect(claimed.size).toBeGreaterThan(5);
    expect([...claimed].filter((c) => !declared.has(c))).toEqual([]);
  });
});
