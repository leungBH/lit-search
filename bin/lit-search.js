#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
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
  summarizeApiKeySources,
} from '../lib/app-config.js';
import {
  parseArgs,
  expandInputPattern,
  getOptionValue,
  getNumberOptionValue,
  resolveInitValue,
  buildRuntimeEngines,
} from './lit-search-utils.js';

if (process.platform === 'win32') {
  try {
    execSync('chcp 65001', { stdio: 'ignore' });
  } catch {
    // Best-effort console mode switch; failure is non-fatal (e.g. chcp
    // is not on PATH, or the shell is non-interactive).
  }
  process.stdout.setDefaultEncoding('utf8');
  process.stderr.setDefaultEncoding('utf8');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, '..');
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8'));
const config = createAppConfig();

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
  --resolve-preprint       Resolve arXiv preprints to formal publication metadata when possible
  --prefer-published       Prefer formal publication metadata for top-level citation fields and BibTeX
  --with-pubmed            Enable optional PubMed/NCBI search for this run
  --with-opencitations     Enable optional OpenCitations DOI relation enrichment for this run
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

Resolve input formats (one citation per line, or BibTeX entries):
  - Bare title:     Attention Is All You Need
  - Numbered list:  1. Attention Is All You Need
  - Bracketed list: [1] Attention Is All You Need
  - Quoted title:   "Attention Is All You Need"
  - DOI:            10.1145/3292500.3330701
  - Title + year:   Attention Is All You Need (2017)
  - BibTeX entry:   @article{key, title={...}, year={2017}}
  Empty lines are skipped. DOI and quoted titles are extracted automatically.

Examples:
  lit-search init
  lit-search "machine learning" -l 5 -s 2022
  lit-search "machine learning" --resolve-preprint --prefer-published
  lit-search "cancer immunotherapy" --with-pubmed
  lit-search merge .\\batch1 .\\batch2 -o .\\merged
  lit-search merge .\\batch1 .\\batch2 -o .\\merged --prefer-published
  lit-search merge .\\batch1 .\\batch2 -o .\\merged --enrich
  lit-search enrich .\\merged
  lit-search enrich .\\merged --fields abstract,keywords,doi,url,venue
  lit-search enrich .\\merged --only-missing abstract
  lit-search enrich .\\merged --only-missing abstract --checkpoint-interval 5
  lit-search resolve .\\citations.txt --output-dir .\\resolved
  lit-search "machine learning" -l 5 --output-dir ./results
  lit-search "AI, coding, agent" --expand pairwise --search-scope title-abstract

Free optional keys configured by lit-search init:
  NCBI API Key             Optional, improves PubMed rate limits
  Unpaywall email          Optional, enables DOI open-access enrichment
`);
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

  // Anything that is not one of the four known subcommands above is
  // either a flag (handled by parseArgs) or a bare/explicit `search`
  // query. Fall through to the search flow.
  const options = parseArgs(command === 'search' ? args.slice(1) : args, {
    cwd: process.cwd(),
    resolvePath: (p) => resolve(p || process.cwd()),
  });

  // parseArgs surfaces help/version/unknown-option/removed-option
  // outcomes as sentinel keys so the pure function can stay testable.
  if (options._help) {
    printHelp();
    return;
  }
  if (options._version) {
    console.log(packageJson.version);
    return;
  }
  if (options._error) {
    console.error(chalk.red(options._error));
    if (options._error.startsWith('Unknown option')) {
      console.log('Run `lit-search --help` for the list of supported options.');
    }
    process.exit(1);
  }

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
  if (options.resolvePreprint || options.preferPublished) {
    console.log(
      `Publication resolution: ${options.resolvePreprint ? 'resolve preprint' : 'off'}${options.preferPublished ? ', prefer published' : ''}`
    );
  }
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
      resolvePreprint: options.resolvePreprint,
      preferPublished: options.preferPublished,
      engines: buildRuntimeEngines(config.get('engines') || {}, options),
      apiKeys: getResolvedApiKeys(config),
      outputBaseDir: options.outputBaseDir,
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
    if (result.metadata.publicationResolution?.enabled) {
      const pub = result.metadata.publicationResolution;
      console.log(`  Pub resolved: ${pub.resolvedPublished}/${pub.attempted}`);
    }

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
  const outputIndex = args.findIndex((arg) => arg === '-o' || arg === '--output-dir');
  const outputDir =
    outputIndex >= 0 ? resolve(args[outputIndex + 1]) : resolve('merged_literature');
  const resolvePreprint =
    args.includes('--resolve-preprint') || args.includes('--prefer-published');
  const preferPublished = args.includes('--prefer-published');
  const withOpenCitations = args.includes('--with-opencitations');
  const optionNames = new Set([
    '--enrich',
    '--resolve-preprint',
    '--prefer-published',
    '--with-opencitations',
  ]);
  const rawInputs = (outputIndex >= 0 ? args.slice(0, outputIndex) : args).filter(
    (arg) => !optionNames.has(arg)
  );
  const inputs = rawInputs.flatMap((p) =>
    expandInputPattern(p, { readdir: readdirSync, exists: existsSync, sep: '/' })
  );
  if (!inputs.length) {
    throw new Error('Please provide at least one pool folder or literature_pool.json path.');
  }
  const result = await mergePools(inputs, outputDir, {
    resolvePreprint,
    preferPublished,
    apiKeys: getResolvedApiKeys(config),
    logger: console,
    engines: buildRuntimeEngines(config.get('engines') || {}, { withOpenCitations }),
  });
  if (args.includes('--enrich')) {
    const enriched = await enrichMetadata(outputDir, {
      apiKeys: getResolvedApiKeys(config),
      logger: console,
    });
    result.pool = enriched.pool;
    result.files = enriched.files;
    console.log(
      chalk.green(
        `Metadata enrichment: ${enriched.stats.enrichedPapers} papers, ${enriched.stats.enrichedFields} fields enriched, ${enriched.stats.lookupFailed} failed`
      )
    );
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
    logger: console,
  });
  console.log(chalk.green(`Metadata enrichment complete: ${result.outputDir}`));
  console.log(
    `Mode:             ${result.pool.metadata.metadataEnrichment.onlyMissing ? 'only missing' : 'missing unless --overwrite'}`
  );
  console.log(`Fields:           ${result.pool.metadata.metadataEnrichment.fields.join(', ')}`);
  console.log(`Concurrency:      ${result.pool.metadata.metadataEnrichment.concurrency}`);
  console.log(
    `Checkpoint every: ${result.pool.metadata.metadataEnrichment.checkpointInterval || 'disabled'}`
  );
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
  const options = parseArgs(args.slice(1), {
    cwd: process.cwd(),
    resolvePath: (p) => resolve(p || process.cwd()),
  });
  const outputDir =
    options.outputBaseDir === process.cwd()
      ? join(process.cwd(), generateOutputFolderName())
      : options.outputBaseDir;
  const result = await resolveCitationsFile(file, {
    limit: options.limit,
    outputDir,
    apiKeys: getResolvedApiKeys(config),
    engines: buildRuntimeEngines(config.get('engines') || {}, options),
    logger: console,
    resolvePreprint: options.resolvePreprint,
    preferPublished: options.preferPublished,
  });
  console.log(chalk.green(`Resolved citations into ${outputDir}`));
  console.log(`Resolved: ${result.pool.papers.length}`);
  console.log(`Unresolved: ${result.unresolved.length}`);
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
      message: `Semantic Scholar API Key${storedApiKeys.s2 ? ' (configured)' : ''}:`,
    },
    {
      type: 'password',
      name: 'openalex',
      mask: '*',
      message: `OpenAlex API Key${storedApiKeys.openalex ? ' (configured)' : ''}:`,
    },
    {
      type: 'input',
      name: 'crossrefMailto',
      message: `CrossRef contact email${storedApiKeys.crossrefMailto ? ` (current: ${storedApiKeys.crossrefMailto})` : ''}:`,
    },
    {
      type: 'password',
      name: 'core',
      mask: '*',
      message: `CORE API Key${storedApiKeys.core ? ' (configured)' : ''}:`,
    },
    {
      type: 'password',
      name: 'ncbi',
      mask: '*',
      message: `NCBI API Key for PubMed (optional)${storedApiKeys.ncbi ? ' (configured)' : ''}:`,
    },
    {
      type: 'input',
      name: 'unpaywallEmail',
      message: `Unpaywall email for OA metadata${storedApiKeys.unpaywallEmail ? ` (current: ${storedApiKeys.unpaywallEmail})` : ''}:`,
    },
  ]);

  saveApiKeys(config, {
    s2: resolveInitValue(answers.s2, storedApiKeys.s2),
    openalex: resolveInitValue(answers.openalex, storedApiKeys.openalex),
    crossrefMailto: resolveInitValue(answers.crossrefMailto, storedApiKeys.crossrefMailto),
    core: resolveInitValue(answers.core, storedApiKeys.core),
    ncbi: resolveInitValue(answers.ncbi, storedApiKeys.ncbi),
    unpaywallEmail: resolveInitValue(answers.unpaywallEmail, storedApiKeys.unpaywallEmail),
  });

  const summary = summarizeApiKeySources(config);
  console.log(chalk.green('\nAPI key configuration saved.'));
  console.log(chalk.gray(`Config file: ${summary.storedPath}`));
  console.log(
    chalk.gray(`Semantic Scholar: ${summary.values.semanticScholar ? 'configured' : 'missing'}`)
  );
  console.log(
    chalk.gray(`OpenAlex:         ${summary.values.openalex ? 'configured' : 'missing'}`)
  );
  console.log(
    chalk.gray(`CrossRef mailto:  ${summary.values.crossrefMailto ? 'configured' : 'missing'}`)
  );
  console.log(chalk.gray(`CORE:             ${summary.values.core ? 'configured' : 'missing'}`));
  console.log(chalk.gray(`NCBI/PubMed:      ${summary.values.ncbi ? 'configured' : 'missing'}`));
  console.log(
    chalk.gray(`Unpaywall email:  ${summary.values.unpaywallEmail ? 'configured' : 'missing'}`)
  );
}

main().catch((error) => {
  console.error(chalk.red(error.message));
  process.exit(1);
});
