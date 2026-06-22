#!/usr/bin/env node
// Run all tests under tests/.
// Default: skip tests marked with [network].
// Set RUN_NETWORK=1 to run network tests.

import { readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runSuites } from './test-runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

async function discover(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      await discover(full, acc);
    } else if (name.endsWith('.test.js')) {
      acc.push(full);
    }
  }
  return acc;
}

const filter = process.argv[2] || '';
const skipNetwork = process.env.RUN_NETWORK !== '1';

const files = await discover(join(__dirname));
console.log(`Discovered ${files.length} test file(s):`);
for (const f of files) console.log(`  - ${f.replace(ROOT + '\\', '').replace(/\\/g, '/')}`);

for (const f of files) {
  if (filter && !f.toLowerCase().includes(filter.toLowerCase())) continue;
  await import(pathToFileURL(f).href);
}

const summary = await runSuites({ filter, skipNetwork });
process.exit(summary.failed > 0 ? 1 : 0);
