#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { generateOutputFolderName } from '../lib/output-files.js';
import { runLitSearchWorkflow } from '../lib/workflow.js';
import { enrichMetadata, mergePools, resolveCitationsFile } from '../lib/pool-ops.js';
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
    } else if (arg === '--pdf' || arg === '--no-pdf' || arg === '--retry') {
      console.error(chalk.red('PDF download options have been removed. lit-search now writes only search_meta.json, literature_pool.json, and references.bib.'));
      process.exit(1);
    } else if (arg === '--format') {
      console.error(chalk.red('The --format option has been removed. lit-search now writes search_meta.json, literature_pool.json, and references.bib.'));
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
  lit-search search [query] [options]
  lit-search merge <pool...> -o <output-dir>
  lit-search enrich <pool-folder|literature_pool.json>
  lit-search resolve <citations.txt> [options]
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
  --enrich                 After merge, enrich missing metadata in the merged pool
  --fields <list>          For enrich, comma-separated metadata fields to enrich
  --only-missing [fields]  For enrich, only fill missing fields, e.g. abstract
  --checkpoint-interval <n>
                           For enrich, save progress every n processed papers (default: 5, 0 disables)
  --concurrency <n>        For enrich, paper-level concurrency (default: 1)
  --overwrite              For enrich, refresh existing metadata too
  -h, --help               Show help
  -v, --version            Show version

Output:
  A new folder is created for each run. It contains:
  - search_meta.json
  - literature_pool.json
  - references.bib

Examples:
  lit-search init
  lit-search "machine learning" -l 5 -s 2022
  lit-search merge .\\batch1 .\\batch2 -o .\\merged
  lit-search merge .\\batch1 .\\batch2 -o .\\merged --enrich
  lit-search enrich .\\merged
  lit-search enrich .\\merged --fields abstract,keywords,doi,url,venue
  lit-search enrich .\\merged --only-missing abstract
  lit-search enrich .\\merged --only-missing abstract --checkpoint-interval 5
  lit-search resolve .\\citations.txt --output-dir .\\resolved
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

  const command = args[0];
  if (command === 'merge') {
    await runMergeCommand(args.slice(1));
    return;
  }
  if (command === 'enrich') {
    await runEnrichCommand(args.slice(1));
    return;
  }
  if (command === 'resolve') {
    await runResolveCommand(args.slice(1));
    return;
  }

  const options = parseArgs(command === 'search' ? args.slice(1) : args);
  if (!options.query) {
    console.error(chalk.red('Please provide a search query.'));
    console.log('Example: lit-search "machine learning" -l 5 -s 2022');
    process.exit(1);
  }

  const outputFolderName = generateOutputFolderName();
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
      outputBaseDir: options.outputBaseDir
    });

    const { result, output } = workflow;

    console.log(chalk.green(`Done. ${result.papers.length} papers found.`));
    console.log(chalk.green(`\nResult folder: ${output.outputDir}`));
    console.log(`  Search metadata: ${output.metaFile}`);
    console.log(`  Literature pool: ${output.poolJsonFile}`);
    console.log(`  BibTeX:          ${output.bibFile}`);

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
    console.error(chalk.red('Search failed.'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

async function runMergeCommand(args) {
  const outputIndex = args.findIndex(arg => arg === '-o' || arg === '--output-dir');
  const outputDir = outputIndex >= 0 ? resolve(args[outputIndex + 1]) : resolve('merged_literature');
  const optionNames = new Set(['--enrich']);
  const rawInputs = (outputIndex >= 0 ? args.slice(0, outputIndex) : args).filter(arg => !optionNames.has(arg));
  const inputs = rawInputs.flatMap(expandInputPattern);
  if (!inputs.length) {
    throw new Error('Please provide at least one pool folder or literature_pool.json path.');
  }
  const result = mergePools(inputs, outputDir);
  if (args.includes('--enrich')) {
    const enriched = await enrichMetadata(outputDir, {
      apiKeys: getResolvedApiKeys(config),
      logger: console
    });
    result.pool = enriched.pool;
    result.files = enriched.files;
    console.log(chalk.green(`Metadata enrichment: ${enriched.stats.enrichedPapers} papers, ${enriched.stats.enrichedFields} fields enriched, ${enriched.stats.lookupFailed} failed`));
  }
  console.log(chalk.green(`Merged ${inputs.length} pool(s) into ${outputDir}`));
  console.log(`Papers: ${result.pool.papers.length}`);
  console.log(`Search metadata: ${result.files.metaFile}`);
  console.log(`Literature pool: ${result.files.poolJsonFile}`);
  console.log(`BibTeX: ${result.files.bibFile}`);
}

async function runEnrichCommand(args) {
  const target = args[0];
  if (!target) {
    throw new Error('Please provide a pool folder or literature_pool.json path.');
  }
  const onlyMissing = args.includes('--only-missing');
  const onlyMissingFields = getOptionValue(args, '--only-missing');
  const fields = getOptionValue(args, '--fields') || (onlyMissing ? onlyMissingFields : null);
  const checkpointInterval = getNumberOptionValue(args, '--checkpoint-interval', 5);
  const concurrency = getNumberOptionValue(args, '--concurrency', 1);
  const result = await enrichMetadata(target, {
    overwrite: args.includes('--overwrite'),
    onlyMissing,
    fields,
    checkpointInterval,
    concurrency,
    apiKeys: getResolvedApiKeys(config),
    logger: console
  });
  console.log(chalk.green(`Metadata enrichment complete: ${result.outputDir}`));
  console.log(`Mode:             ${result.pool.metadata.metadataEnrichment.onlyMissing ? 'only missing' : 'missing unless --overwrite'}`);
  console.log(`Fields:           ${result.pool.metadata.metadataEnrichment.fields.join(', ')}`);
  console.log(`Concurrency:      ${result.pool.metadata.metadataEnrichment.concurrency}`);
  console.log(`Checkpoint every: ${result.pool.metadata.metadataEnrichment.checkpointInterval || 'disabled'}`);
  console.log(`Complete:         ${result.stats.complete}`);
  console.log(`Attempted:        ${result.stats.attempted}`);
  console.log(`Enriched papers:  ${result.stats.enrichedPapers}`);
  console.log(`Enriched fields:  ${result.stats.enrichedFields}`);
  console.log(`Lookup failed:    ${result.stats.lookupFailed}`);
  console.log(`Search metadata:  ${result.files.metaFile}`);
  console.log(`Literature pool:  ${result.files.poolJsonFile}`);
  console.log(`BibTeX:           ${result.files.bibFile}`);
}

async function runResolveCommand(args) {
  const file = args[0];
  if (!file) {
    throw new Error('Please provide a citations text file.');
  }
  const options = parseArgs(args.slice(1));
  const outputDir = options.outputBaseDir === process.cwd()
    ? join(process.cwd(), generateOutputFolderName())
    : options.outputBaseDir;
  const result = await resolveCitationsFile(file, {
    limit: options.limit,
    outputDir,
    apiKeys: getResolvedApiKeys(config),
    engines: config.get('engines') || {},
    logger: console
  });
  console.log(chalk.green(`Resolved citations into ${outputDir}`));
  console.log(`Resolved: ${result.pool.papers.length}`);
  console.log(`Unresolved: ${result.unresolved.length}`);
}

function expandInputPattern(pattern) {
  if (!pattern.includes('*')) return [pattern];
  const absolute = resolve(pattern);
  const dir = dirname(absolute);
  const regex = new RegExp(`^${absolute.split(/[\\/]/).pop().replace(/\*/g, '.*')}$`);
  return readdirSync(dir)
    .filter(name => regex.test(name))
    .map(name => join(dir, name))
    .filter(path => existsSync(path));
}

function getOptionValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  return value && !value.startsWith('-') ? value : null;
}

function getNumberOptionValue(args, name, fallback) {
  const value = getOptionValue(args, name);
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

main().catch(error => {
  console.error(chalk.red(error.message));
  process.exit(1);
});
