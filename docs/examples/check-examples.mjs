#!/usr/bin/env node
/**
 * Compile-checks all example component files.
 *
 * - React JSX: parsed with acorn + acorn-jsx
 * - Vue SFCs: parsed with @vue/compiler-sfc
 * - Svelte: compiled with svelte/compiler
 * - Astro: parsed with @astrojs/compiler (falls back to a lightweight
 *   structural check if the compiler isn't installed)
 *
 * Install dependencies first: cd docs/blocks && pnpm install
 *
 * Usage:
 *   node check-examples.mjs
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, 'examples');

let errors = 0;
let checked = 0;

async function checkReact(filePath, name) {
  try {
    const { Parser } = await import('acorn');
    const acornJsx = (await import('acorn-jsx')).default;
    const JsxParser = Parser.extend(acornJsx());
    const code = readFileSync(filePath, 'utf-8');
    JsxParser.parse(code, {
      sourceType: 'module',
      ecmaVersion: 'latest',
    });
    checked++;
  } catch (err) {
    console.error(`FAIL react/${name}: ${err.message}`);
    errors++;
  }
}

async function checkVue(filePath, name) {
  try {
    const { parse } = await import('@vue/compiler-sfc');
    const code = readFileSync(filePath, 'utf-8');
    const { errors: parseErrors } = parse(code, { filename: name });
    if (parseErrors.length > 0) {
      for (const e of parseErrors) {
        console.error(`FAIL vue/${name}: ${e.message}`);
      }
      errors++;
    } else {
      checked++;
    }
  } catch (err) {
    console.error(`FAIL vue/${name}: ${err.message}`);
    errors++;
  }
}

async function checkSvelte(filePath, name) {
  try {
    const { compile } = await import('svelte/compiler');
    const code = readFileSync(filePath, 'utf-8');
    compile(code, {
      filename: name,
      generate: false, // parse + validate only, no codegen
    });
    checked++;
  } catch (err) {
    console.error(`FAIL svelte/${name}: ${err.message}`);
    errors++;
  }
}

async function checkAstro(filePath, name) {
  const code = readFileSync(filePath, 'utf-8');
  try {
    const { parse } = await import('@astrojs/compiler');
    const result = await parse(code, { position: true });
    const diagnostics = result.diagnostics || [];
    // severity: 0=error, 1=warning, 2=info — only fail on errors.
    const errs = diagnostics.filter((d) => d.severity === 0);
    if (errs.length > 0) {
      for (const diag of errs) {
        console.error(`FAIL astro/${name}: ${diag.text}`);
      }
      errors++;
    } else {
      checked++;
    }
  } catch (err) {
    // Fallback: @astrojs/compiler isn't installed in this environment.
    // This structural check is intentionally lenient — it will miss
    // many semantic errors (it can't validate JS expressions, attribute
    // syntax, or component/import correctness) but reliably catches
    // gross truncation: an unclosed frontmatter fence, wildly
    // unbalanced braces, or wildly unbalanced angle brackets. Naive
    // counts ignore strings/comments/TS generics, so we only flag
    // angle-bracket counts that differ by more than 2.
    if (err && err.code !== 'ERR_MODULE_NOT_FOUND') {
      console.error(`FAIL astro/${name}: ${err.message}`);
      errors++;
      return;
    }
    let failed = false;
    const frontmatterOpen = code.match(/^\s*---\r?\n/);
    if (frontmatterOpen) {
      const rest = code.slice(frontmatterOpen[0].length);
      if (!/\r?\n---(\r?\n|$)/.test(rest)) {
        console.error(`FAIL astro/${name}: unterminated frontmatter (missing closing ---)`);
        failed = true;
      }
    }
    const opens = (code.match(/\{/g) || []).length;
    const closes = (code.match(/\}/g) || []).length;
    if (opens + closes > 0 && opens !== closes) {
      console.error(`FAIL astro/${name}: unbalanced curly braces (${opens} vs ${closes})`);
      failed = true;
    }
    const lts = (code.match(/</g) || []).length;
    const gts = (code.match(/>/g) || []).length;
    if (Math.abs(lts - gts) > 2) {
      console.error(`FAIL astro/${name}: unbalanced angle brackets (${lts} vs ${gts})`);
      failed = true;
    }
    if (failed) {
      errors++;
    } else {
      checked++;
    }
  }
}

// Check React files
const reactDir = join(examplesDir, 'react');
for (const file of readdirSync(reactDir)) {
  if (extname(file) === '.jsx') {
    await checkReact(join(reactDir, file), file);
  }
}

// Check Vue files
const vueDir = join(examplesDir, 'vue');
for (const file of readdirSync(vueDir)) {
  if (extname(file) === '.vue') {
    await checkVue(join(vueDir, file), file);
  }
}

// Check Svelte files
const svelteDir = join(examplesDir, 'svelte');
for (const file of readdirSync(svelteDir)) {
  if (extname(file) === '.svelte') {
    await checkSvelte(join(svelteDir, file), file);
  }
}

// Check Astro files
const astroDir = join(examplesDir, 'astro');
for (const file of readdirSync(astroDir)) {
  if (extname(file) === '.astro') {
    await checkAstro(join(astroDir, file), file);
  }
}

console.log(`\nChecked ${checked} files, ${errors} errors.`);
if (errors > 0) {
  process.exit(1);
}
