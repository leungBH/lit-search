import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderOutput } from './output.js';

export function generateOutputFolderName(query) {
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
  const keywords = query
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .join('_')
    .replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '');

  return `${keywords || 'lit_search'}_${date}_${time}`;
}

export function writeResultFiles(result, outputDir) {
  mkdirSync(outputDir, { recursive: true });

  const markdownFile = join(outputDir, 'results.md');
  const bibFile = join(outputDir, 'references.bib');

  writeFileSync(markdownFile, renderOutput(result, 'md'), 'utf-8');
  writeFileSync(bibFile, renderOutput(result, 'bib'), 'utf-8');

  return {
    markdownFile,
    bibFile
  };
}
