#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { generateOutputFolderName } from '../lib/output-files.js';
import { runLitSearchWorkflow } from '../lib/workflow.js';
import {
  createAppConfig,
  getResolvedApiKeys,
  getStoredApiKeys,
  saveApiKeys,
  summarizeApiKeySources
} from '../lib/app-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, '..');
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8'));
const config = createAppConfig();

function parseArgs(args) {
  const options = {
    query: null,
    limit: 3,
    yearStart: null,
    yearEnd: null,
    queryExpansion: 'none',
    searchScope: 'default-engine-search',
    outputBaseDir: process.cwd()
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--limit' || arg === '-l') {
      options.limit = parseInt(args[++i], 10) || 3;
    } else if (arg === '--since' || arg === '-s' || arg === '--year-start') {
      options.yearStart = parseInt(args[++i], 10) || null;
    } else if (arg === '--until' || arg === '-u' || arg === '--year-end') {
      options.yearEnd = parseInt(args[++i], 10) || null;
    } else if (arg === '--expand') {
      options.queryExpansion = normalizeQueryExpansion(args[++i]);
    } else if (arg === '--search-scope') {
      options.searchScope = normalizeSearchScope(args[++i]);
    } else if (arg === '--output-dir') {
      options.outputBaseDir = resolve(args[++i] || process.cwd());
    } else if (arg === '--format') {
      console.error(chalk.red('The --format option has been removed. lit-search now always writes md and bib outputs.'));
      process.exit(1);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--version' || arg === '-v') {
      console.log(packageJson.version);
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      options.query = arg;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
lit-search v${packageJson.version}

Usage:
  lit-search [query] [options]
  lit-search init

Arguments:
  query                    Search query. Use commas for multiple keywords.

Options:
  -l, --limit <n>          Per-keyword, per-source retrieval limit (default: 3)
  -s, --since <year>       Inclusive start year
  -u, --until <year>       Inclusive end year
  --expand <mode>          Query expansion: none|pairwise|full (default: none)
  --search-scope <mode>    title-only|title-abstract|default-engine-search
  --output-dir <dir>       Parent directory for generated result folders
  -h, --help               Show help
  -v, --version            Show version

Output:
  A new folder is created for each run. It contains:
  - results.md
  - references.bib
  - pdfs/

Examples:
  lit-search init
  lit-search "machine learning" -l 5 -s 2022
  lit-search "machine learning" -l 5 --output-dir ./results
  lit-search "AI, coding, agent" --expand pairwise --search-scope title-abstract
`);
}

function normalizeQueryExpansion(value) {
  const normalized = (value || '').toLowerCase().trim();
  const allowed = new Set(['none', 'pairwise', 'full']);
  if (!allowed.has(normalized)) {
    console.error(chalk.red(`Unsupported query expansion: ${value}`));
    console.log('Allowed values: none, pairwise, full\n');
    process.exit(1);
  }
  return normalized;
}

function normalizeSearchScope(value) {
  const normalized = (value || '').toLowerCase().trim();
  const allowed = new Set(['title-only', 'title-abstract', 'default-engine-search']);
  if (!allowed.has(normalized)) {
    console.error(chalk.red(`Unsupported search scope: ${value}`));
    console.log('Allowed values: title-only, title-abstract, default-engine-search\n');
    process.exit(1);
  }
  return normalized;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  if (args[0] === 'init') {
    await runInit();
    return;
  }

  const options = parseArgs(args);
  if (!options.query) {
    console.error(chalk.red('Please provide a search query.'));
    console.log('Example: lit-search "machine learning" -l 5 -s 2022');
    process.exit(1);
  }

  const outputFolderName = generateOutputFolderName(options.query);
  const plannedOutputDir = join(options.outputBaseDir, outputFolderName);

  console.log(chalk.bold.blue('\nlit-search\n'));
  console.log(`Query: ${options.query}`);
  console.log(`Limit: ${options.limit} per keyword per source`);
  console.log(`Expansion: ${options.queryExpansion}`);
  console.log(`Search scope: ${options.searchScope}`);
  console.log(`Output folder: ${plannedOutputDir}`);
  if (options.yearStart || options.yearEnd) {
    console.log(`Year range: ${options.yearStart || '...'} - ${options.yearEnd || '...'}`);
  }
  console.log();

  let spinner = null;

  try {
    const workflow = await runLitSearchWorkflow({
      query: options.query,
      keywords: [],
      excludeTerms: [],
      yearStart: options.yearStart,
      yearEnd: options.yearEnd,
      limit: options.limit,
      queryExpansion: options.queryExpansion,
      searchScope: options.searchScope,
      engines: config.get('engines') || {},
      apiKeys: getResolvedApiKeys(config),
      outputBaseDir: options.outputBaseDir,
      hooks: {
        onBeforePdfDownload: () => {
          if (process.stdout.isTTY) {
            spinner = ora('Downloading PDFs...').start();
          }
        }
      }
    });

    const { result, output, pdfSummary } = workflow;

    if (spinner) {
      spinner.succeed(`Done. ${result.papers.length} papers found.`);
    } else {
      console.log(chalk.green(`Done. ${result.papers.length} papers found.`));
    }
    console.log(chalk.green(`\nResult folder: ${output.outputDir}`));
    console.log(`  Markdown: ${output.markdownFile}`);
    console.log(`  BibTeX:   ${output.bibFile}`);
    console.log(`  PDFs:     ${pdfSummary.pdfDir} (${pdfSummary.downloaded}/${pdfSummary.total} downloaded)`);

    console.log(chalk.bold('\nSummary:'));
    console.log(`  Retrieved:    ${result.metadata.totalRetrieved}`);
    console.log(`  Deduplicated: ${result.metadata.afterDedup}`);
    console.log(`  Final:        ${result.metadata.finalCount}`);

    if (result.metadata.engineStats) {
      console.log(chalk.bold('\nEngines:'));
      for (const stat of result.metadata.engineStats) {
        console.log(`  ${stat.engine}: ${stat.status} (${stat.totalPapers})`);
        for (const qr of stat.queryResults) {
          if (qr.status === 'failed') {
            console.log(`    - "${qr.query}": ${qr.error}`);
          }
        }
      }
    }
  } catch (error) {
    if (spinner) {
      spinner.fail('Search failed.');
    } else {
      console.error(chalk.red('Search failed.'));
    }
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

async function runInit() {
  const storedApiKeys = getStoredApiKeys(config);

  console.log(chalk.bold.blue('\nlit-search init\n'));
  console.log('Leave blank to keep the current value. Enter "-" to clear a value.\n');

  const answers = await inquirer.prompt([
    {
      type: 'password',
      name: 's2',
      mask: '*',
      message: `Semantic Scholar API Key${storedApiKeys.s2 ? ' (configured)' : ''}:`
    },
    {
      type: 'password',
      name: 'openalex',
      mask: '*',
      message: `OpenAlex API Key${storedApiKeys.openalex ? ' (configured)' : ''}:`
    },
    {
      type: 'input',
      name: 'crossrefMailto',
      message: `CrossRef contact email${storedApiKeys.crossrefMailto ? ` (current: ${storedApiKeys.crossrefMailto})` : ''}:`
    },
    {
      type: 'password',
      name: 'core',
      mask: '*',
      message: `CORE API Key${storedApiKeys.core ? ' (configured)' : ''}:`
    }
  ]);

  saveApiKeys(config, {
    s2: resolveInitValue(answers.s2, storedApiKeys.s2),
    openalex: resolveInitValue(answers.openalex, storedApiKeys.openalex),
    crossrefMailto: resolveInitValue(answers.crossrefMailto, storedApiKeys.crossrefMailto),
    core: resolveInitValue(answers.core, storedApiKeys.core)
  });

  const summary = summarizeApiKeySources(config);
  console.log(chalk.green('\nAPI key configuration saved.'));
  console.log(chalk.gray(`Config file: ${summary.storedPath}`));
  console.log(chalk.gray(`Semantic Scholar: ${summary.values.semanticScholar ? 'configured' : 'missing'}`));
  console.log(chalk.gray(`OpenAlex:         ${summary.values.openalex ? 'configured' : 'missing'}`));
  console.log(chalk.gray(`CrossRef mailto:  ${summary.values.crossrefMailto ? 'configured' : 'missing'}`));
  console.log(chalk.gray(`CORE:             ${summary.values.core ? 'configured' : 'missing'}`));
}

function resolveInitValue(input, currentValue) {
  if (input === '-') return null;
  if (input === '' || input === undefined) return currentValue || null;
  return String(input).trim() || currentValue || null;
}

main();
