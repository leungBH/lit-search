#!/usr/bin/env node

/**
 * lit-search - Academic Literature Search CLI
 * 简化版：手动解析参数
 */

import { readFileSync, writeFileSync } from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { renderOutput } from '../lib/output.js';
import { searchPapers } from '../lib/search.js';
import { createAppConfig, getResolvedApiKeys, getStoredApiKeys, saveApiKeys, summarizeApiKeySources } from '../lib/app-config.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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
    format: null,
    queryExpansion: 'none',
    searchScope: 'default-engine-search'
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--limit' || arg === '-l') {
      options.limit = parseInt(args[++i], 10) || 3;
    } else if (arg === '--since' || arg === '-s' || arg === '--year-start') {
      options.yearStart = parseInt(args[++i], 10) || null;
    } else if (arg === '--until' || arg === '-u' || arg === '--year-end') {
      options.yearEnd = parseInt(args[++i], 10) || null;
    } else if (arg === '--format') {
      options.format = normalizeOutputFormat(args[++i]);
    } else if (arg === '--expand') {
      options.queryExpansion = normalizeQueryExpansion(args[++i]);
    } else if (arg === '--search-scope') {
      options.searchScope = normalizeSearchScope(args[++i]);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--version' || arg === '-v') {
      console.log(packageJson.version);
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      options.query = arg;
    }

    i++;
  }

  return options;
}

function generateOutputFilename(query) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  const keywords = query.split(',').map(k => k.trim()).join('_').replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '');
  const dateStr = `${year}${month}${day}`;
  const timeStr = `${hours}${minutes}${seconds}`;

  return `${keywords}_${dateStr}_${timeStr}`;
}

function printHelp() {
  console.log(`
📚 lit-search v${packageJson.version} - 学术文献检索 CLI

用法:
  lit-search [关键词] [选项]
  lit-search search [关键词] [选项]
  lit-search init

参数:
  关键词                  搜索词（多个关键词用逗号分隔）

  选项:
  -l, --limit <n>         每个关键词、每个数据源的检索上限（默认: 3）
  -s, --since <year>      起始年份（包含）
  -u, --until <year>      结束年份（包含）
  --format <mode>         输出格式：md|json|bib（默认: md）
  --expand <mode>         查询展开策略：none|pairwise|full（默认: none）
  --search-scope <mode>   检索范围：title-only|title-abstract|default-engine-search
  -h, --help              显示帮助
  -v, --version           显示版本

示例:
  lit-search init
  lit-search "AI, coding" -l 5 -s 2022
  lit-search "machine learning" --limit 10 --since 2020 --until 2024

数据源:
  Semantic Scholar, OpenAlex, arXiv, CrossRef, CORE
`);
}

function normalizeQueryExpansion(value) {
  const normalized = (value || '').toLowerCase().trim();
  const allowed = new Set(['none', 'pairwise', 'full']);

  if (!allowed.has(normalized)) {
    console.error(chalk.red(`❌ 不支持的查询展开策略: ${value}`));
    console.log('可选值: none, pairwise, full\n');
    process.exit(1);
  }

  return normalized;
}

function normalizeOutputFormat(value) {
  const normalized = (value || '').toLowerCase().trim();
  const allowed = new Set(['md', 'json', 'bib']);

  if (!allowed.has(normalized)) {
    console.error(chalk.red(`❌ 不支持的输出格式: ${value}`));
    console.log('可选值: md, json, bib\n');
    process.exit(1);
  }

  return normalized;
}

function normalizeSearchScope(value) {
  const normalized = (value || '').toLowerCase().trim();
  const allowed = new Set(['title-only', 'title-abstract', 'default-engine-search']);

  if (!allowed.has(normalized)) {
    console.error(chalk.red(`❌ 不支持的检索范围: ${value}`));
    console.log('可选值: title-only, title-abstract, default-engine-search\n');
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
    console.error(chalk.red('❌ 请提供搜索关键词'));
    console.log('\n使用示例:');
    console.log('  lit-search "AI, coding"');
    console.log('  lit-search "machine learning" -l 10 -s 2022');
    console.log('\n运行 lit-search --help 查看更多选项\n');
    process.exit(1);
  }

  const outputFormat = options.format || 'md';
  const outputFile = `${generateOutputFilename(options.query)}.${outputFormat}`;

  console.log(chalk.bold.blue('\n📚 lit-search - 学术文献检索\n'));

  console.log(`📋 参数:`);
  console.log(`   查询: ${options.query}`);
  console.log(`   检索上限: 每个关键词、每个数据源 ${options.limit} 篇`);
  console.log(`   展开策略: ${options.queryExpansion}`);
  console.log(`   检索范围: ${options.searchScope}`);
  console.log(`   输出格式: ${outputFormat}`);
  if (options.yearStart || options.yearEnd) {
    console.log(`   年份: ${options.yearStart || '...'} - ${options.yearEnd || '...'}`);
  }
  console.log();

  const spinner = ora('检索中...').start();

  try {
    const engines = config.get('engines') || {};
    const apiKeys = getResolvedApiKeys(config);
    const result = await searchPapers({
      query: options.query,
      keywords: [],
      excludeTerms: [],
      yearStart: options.yearStart,
      yearEnd: options.yearEnd,
      limit: options.limit,
      queryExpansion: options.queryExpansion,
      searchScope: options.searchScope,
      engines,
      apiKeys
    });

    spinner.succeed(`检索完成！共 ${result.papers.length} 篇文献`);

    writeFileSync(outputFile, renderOutput(result, outputFormat), 'utf-8');
    console.log(chalk.green(`\n✓ 结果已保存到: ${outputFile}`));

    console.log(chalk.bold('\n📊 统计摘要:'));
    console.log(`  原始检索: ${result.metadata.totalRetrieved} 篇`);
    console.log(`  去重后:   ${result.metadata.afterDedup} 篇`);
    console.log(`  最终结果: ${result.metadata.finalCount} 篇`);

    if (result.metadata.engineStats) {
      console.log(chalk.bold('\n🔍 各引擎检索状态:'));
      for (const stat of result.metadata.engineStats) {
        const statusIcon = stat.status === 'success' ? '✅' : stat.status === 'network_error' ? '⚠️' : '❌';
        const statusText = stat.status === 'success' ? '成功' : stat.status === 'network_error' ? '网络错误' : '无结果';
        console.log(`  ${statusIcon} ${stat.engine}: ${statusText} (${stat.totalPapers} 篇)`);
        for (const qr of stat.queryResults) {
          if (qr.status === 'failed') {
            console.log(`      - "${qr.query}": 失败 (${qr.error})`);
          }
        }
      }
    }

  } catch (error) {
    spinner.fail('检索失败');
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

async function runInit() {
  const storedApiKeys = getStoredApiKeys(config);

  console.log(chalk.bold.blue('\n🔐 lit-search 初始化配置\n'));
  console.log('留空表示保持当前值，输入 "-" 表示清空该项。\n');

  const answers = await inquirer.prompt([
    {
      type: 'password',
      name: 's2',
      mask: '*',
      message: `Semantic Scholar API Key${storedApiKeys.s2 ? '（已配置）' : ''}:`
    },
    {
      type: 'password',
      name: 'openalex',
      mask: '*',
      message: `OpenAlex API Key${storedApiKeys.openalex ? '（已配置）' : ''}:`
    },
    {
      type: 'input',
      name: 'crossrefMailto',
      message: `CrossRef 联系邮箱${storedApiKeys.crossrefMailto ? `（当前: ${storedApiKeys.crossrefMailto}）` : ''}:`
    },
    {
      type: 'password',
      name: 'core',
      mask: '*',
      message: `CORE API Key${storedApiKeys.core ? '（已配置）' : ''}:`
    }
  ]);

  const nextApiKeys = {
    s2: resolveInitValue(answers.s2, storedApiKeys.s2),
    openalex: resolveInitValue(answers.openalex, storedApiKeys.openalex),
    crossrefMailto: resolveInitValue(answers.crossrefMailto, storedApiKeys.crossrefMailto),
    core: resolveInitValue(answers.core, storedApiKeys.core)
  };

  saveApiKeys(config, nextApiKeys);

  const summary = summarizeApiKeySources(config);
  console.log(chalk.green('\n✓ API Key 已保存到本机配置'));
  console.log(chalk.gray(`  配置文件: ${summary.storedPath}`));
  console.log(chalk.gray(`  Semantic Scholar: ${summary.values.semanticScholar ? '已配置' : '未配置'}`));
  console.log(chalk.gray(`  OpenAlex:         ${summary.values.openalex ? '已配置' : '未配置'}`));
  console.log(chalk.gray(`  CrossRef mailto:  ${summary.values.crossrefMailto ? '已配置' : '未配置'}`));
  console.log(chalk.gray(`  CORE:             ${summary.values.core ? '已配置' : '未配置'}`));
  console.log(chalk.gray('\n提示: 环境变量会覆盖本机配置，可用于 MCP、CI 或临时切换账号。'));
}

function resolveInitValue(input, currentValue) {
  if (input === '-') return null;
  if (input === '' || input === undefined) return currentValue || null;
  return String(input).trim() || currentValue || null;
}

main();
