#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { generateOutputFolderName, readLiteraturePool, resolvePoolPath } from '../lib/output-files.js';
import { downloadPoolPdfs, runLitSearchWorkflow } from '../lib/workflow.js';
import { enrichMetadata, filterPapersForPdfRetry, mergePools, resolveCitationsFile, summarizePool } from '../lib/pool-ops.js';
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
    outputBaseDir: process.cwd(),
    downloadPdf: false
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
    } else if (arg === '--pdf') {
      options.downloadPdf = true;
    } else if (arg === '--no-pdf') {
      options.downloadPdf = false;
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
  lit-search search [query] [options]
  lit-search pdf <pool-folder|literature_pool.json|pdf_status.md> [--retry all|failed|missing]
  lit-search status <pool-folder|literature_pool.json|pdf_status.md>
  lit-search merge <pool...> -o <output-dir>
  lit-search enrich <pool-folder|literature_pool.json|literature_pool.md>
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
  --pdf                    Download PDFs after writing literature pool files
  --no-pdf                 Do not download PDFs (default)
  --retry <mode>           PDF retry mode for "pdf": all|failed|missing (default: all)
  --enrich                 After merge, enrich missing metadata in the merged pool
  --fields <list>          For enrich, comma-separated metadata fields to enrich
  --overwrite              For enrich, refresh existing metadata too
  -h, --help               Show help
  -v, --version            Show version

Output:
  A new folder is created for each run. It contains:
  - literature_pool.md
  - literature_pool.json
  - references.bib
  - pdf_status.md
  - pdfs/

Examples:
  lit-search init
  lit-search "machine learning" -l 5 -s 2022
  lit-search search "machine learning" --pdf
  lit-search pdf .\\lit_search_20260518_153020
  lit-search pdf .\\lit_search_20260518_153020\\pdf_status.md --retry failed
  lit-search status .\\lit_search_20260518_153020
  lit-search merge .\\batch1 .\\batch2 -o .\\merged
  lit-search merge .\\batch1 .\\batch2 -o .\\merged --enrich
  lit-search enrich .\\merged
  lit-search enrich .\\merged --fields abstract,keywords,doi,url,venue
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
  if (command === 'pdf') {
    await runPdfCommand(args.slice(1));
    return;
  }
  if (command === 'status') {
    await runStatusCommand(args.slice(1));
    return;
  }
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
      downloadPdf: options.downloadPdf,
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
    console.log(`  Literature pool: ${output.literaturePoolFile}`);
    console.log(`  BibTeX:          ${output.bibFile}`);
    console.log(`  PDF status:      ${output.pdfStatusFile}`);
    console.log(`  PDFs:            ${pdfSummary.pdfDir} (${pdfSummary.downloaded}/${pdfSummary.total} downloaded)`);

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

async function runPdfCommand(args) {
  const target = args[0];
  if (!target) {
    throw new Error('Please provide a pool folder or literature_pool.json path.');
  }
  const poolFile = resolvePoolPath(target);
  const pool = readLiteraturePool(poolFile);
  const retryMode = getOptionValue(args, '--retry') || 'all';
  const targetPapers = filterPapersForPdfRetry(pool.papers || [], retryMode);
  const outputDir = dirname(poolFile);
  const spinner = process.stdout.isTTY ? ora('Downloading PDFs...').start() : null;
  const workflow = await downloadPoolPdfs(pool, outputDir, { logger: console, papers: targetPapers });
  if (spinner) spinner.succeed('PDF download complete.');
  console.log(chalk.green(`PDF status: ${workflow.output.pdfStatusFile}`));
  console.log(`PDFs: ${workflow.output.pdfDir} (${workflow.pdfSummary.downloaded}/${workflow.pdfSummary.total} downloaded)`);
}

async function runStatusCommand(args) {
  const target = args[0];
  if (!target) {
    throw new Error('Please provide a pool folder or literature_pool.json path.');
  }
  const pool = readLiteraturePool(target);
  const summary = summarizePool(pool);
  console.log(chalk.bold('\nlit-search status\n'));
  console.log(`Papers: ${summary.papers}`);
  console.log(`PDF downloaded: ${summary.pdf.downloaded}`);
  console.log(`PDF not attempted: ${summary.pdf.notAttempted}`);
  console.log(`PDF missing URL: ${summary.pdf.missingUrl}`);
  console.log(`PDF failed: ${summary.pdf.failed}`);
  console.log(`PDF skipped: ${summary.pdf.skipped}`);
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
  console.log(`Literature pool: ${result.files.literaturePoolFile}`);
  console.log(`BibTeX: ${result.files.bibFile}`);
}

async function runEnrichCommand(args) {
  const target = args[0];
  if (!target) {
    throw new Error('Please provide a pool folder, literature_pool.json, or literature_pool.md path.');
  }
  const result = await enrichMetadata(target, {
    overwrite: args.includes('--overwrite'),
    fields: getOptionValue(args, '--fields'),
    apiKeys: getResolvedApiKeys(config),
    logger: console
  });
  console.log(chalk.green(`Metadata enrichment complete: ${result.outputDir}`));
  console.log(`Complete:         ${result.stats.complete}`);
  console.log(`Attempted:        ${result.stats.attempted}`);
  console.log(`Enriched papers:  ${result.stats.enrichedPapers}`);
  console.log(`Enriched fields:  ${result.stats.enrichedFields}`);
  console.log(`Lookup failed:    ${result.stats.lookupFailed}`);
  console.log(`Literature pool:  ${result.files.literaturePoolFile}`);
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
  return index >= 0 ? args[index + 1] : null;
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
