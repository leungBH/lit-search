import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { renderBibTeX } from './output.js';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

export function generateOutputFolderName() {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('');
  const time = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('');

  return `lit_search_${date}_${time}`;
}

export function writeResultFiles(result, outputDir, options = {}) {
  mkdirSync(outputDir, { recursive: true });

  const bibFile = join(outputDir, 'references.bib');
  const poolJsonFile = join(outputDir, 'literature_pool.json');
  const metaFile = join(outputDir, 'search_meta.json');

  writeFileSync(bibFile, renderBibTeX(result), 'utf-8');
  writeFileSync(poolJsonFile, `${JSON.stringify(result, null, 2)}\n`, 'utf-8');
  writeFileSync(metaFile, `${JSON.stringify(buildSearchMeta(result, options), null, 2)}\n`, 'utf-8');

  return {
    bibFile,
    poolJsonFile,
    metaFile
  };
}

export function resolvePoolPath(inputPath) {
  const absolute = resolve(inputPath);
  if (absolute.endsWith('.json')) return absolute;
  if (existsSync(join(absolute, 'literature_pool.json'))) {
    return join(absolute, 'literature_pool.json');
  }
  throw new Error(`Cannot find literature_pool.json from: ${inputPath}`);
}

export function readLiteraturePool(inputPath) {
  const poolFile = resolvePoolPath(inputPath);
  return JSON.parse(readFileSync(poolFile, 'utf-8').replace(/^\uFEFF/, ''));
}

function buildSearchMeta(result, options) {
  return {
    tool: 'lit-search',
    version: packageJson.version,
    generatedAt: new Date().toISOString(),
    mode: options.mode || 'search',
    outputDir: options.outputDir || null,
    files: {
      searchMeta: 'search_meta.json',
      literaturePool: 'literature_pool.json',
      references: 'references.bib'
    },
    metadata: result.metadata
  };
}
