/**
 * lit-search 测试脚本
 * 用于快速验证功能是否正常
 */

import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import chalk from 'chalk';

const tests = [
  {
    name: '基本搜索（limit=3, year>=2022）',
    args: ['test', '-l', '3', '-s', '2022', '--format', 'json'],
    expect: { minResults: 1, yearMin: 2022 }
  },
  {
    name: '多关键词搜索',
    args: ['AI, coding', '-l', '5', '-s', '2023', '--format', 'json'],
    expect: { minResults: 1, yearMin: 2023 }
  },
  {
    name: '无年份限制',
    args: ['machine learning', '-l', '4', '--format', 'json'],
    expect: { minResults: 1 }
  },
  {
    name: '结束年份测试（year<=2020）',
    args: ['neural network', '-l', '3', '-u', '2020', '--format', 'json'],
    expect: { minResults: 1, yearMax: 2020 }
  },
  {
    name: '完整年份范围（2020-2024）',
    args: ['deep learning', '-l', '3', '-s', '2020', '-u', '2024', '--format', 'json'],
    expect: { minResults: 1, yearMin: 2020, yearMax: 2024 }
  },
  {
    name: 'JSON输出格式',
    args: ['transformer', '-l', '2', '-s', '2022', '--format', 'json'],
    expect: { minResults: 1, format: 'json' }
  },
  {
    name: 'BibTeX输出格式',
    args: ['attention mechanism', '-l', '2', '-s', '2023', '--format', 'bib'],
    expect: { minResults: 1, format: 'bib' }
  },
  {
    name: '查询展开-pairwise策略',
    args: ['graph, neural', '-l', '3', '-s', '2022', '--expand', 'pairwise', '--format', 'json'],
    expect: { minResults: 1, yearMin: 2022 }
  },
  {
    name: '查询展开-full策略',
    args: ['reinforcement, learning', '-l', '3', '-s', '2021', '--expand', 'full', '--format', 'json'],
    expect: { minResults: 1, yearMin: 2021 }
  },
  {
    name: '检索范围-title-only',
    args: ['computer vision', '-l', '3', '-s', '2022', '--search-scope', 'title-only', '--format', 'json'],
    expect: { minResults: 1, yearMin: 2022 }
  },
  {
    name: '检索范围-title-abstract',
    args: ['natural language processing', '-l', '3', '-s', '2022', '--search-scope', 'title-abstract', '--format', 'json'],
    expect: { minResults: 1, yearMin: 2022 }
  }
];

const cliEntry = resolve(process.cwd(), 'bin/lit-search.js');

function findOutputFileByQuery(dir, query, format) {
  const ext = format === 'bib' ? '.bib' : (format === 'json' ? '.json' : '.md');
  const normalizedQuery = query.split(',').map(k => k.trim()).join('_').replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '');

  const files = readdirSync(dir);
  for (const file of files) {
    if (file.includes(normalizedQuery) && file.endsWith(ext)) {
      return join(dir, file);
    }
  }
  return null;
}

async function runTest(test) {
  console.log(`\n${chalk.bold('━'.repeat(60))}`);
  console.log(`📋 测试: ${test.name}`);
  console.log(`   命令: ${process.execPath} ${test.args.join(' ')}`);
  console.log('─'.repeat(60));

  const projectRoot = process.cwd();
  const format = test.expect.format || 'md';
  const tempDir = mkdtempSync(join(tmpdir(), 'lit-search-test-'));

  let outputFile = null;

  try {
    const output = execFileSync(process.execPath, [cliEntry, ...test.args], {
      encoding: 'utf-8',
      cwd: tempDir,
      timeout: 120000,
      stdio: 'pipe'
    });

    console.log(output);

    outputFile = findOutputFileByQuery(tempDir, test.args[0], format);

    if (!outputFile) {
      console.log(chalk.red(`❌ 失败: 未找到输出文件 (格式: ${format}, 查询: ${test.args[0]})`));
      const files = [];
      console.log(chalk.gray(`   目录中的输出文件: ${files.join(', ')}`));
      return false;
    }

    if (format === 'bib') {
      const bibContent = readFileSync(outputFile, 'utf-8');
      if (!bibContent.includes('@') || !bibContent.includes('title')) {
        console.log(chalk.red(`❌ 失败: BibTeX 格式不正确`));
        return false;
      }
      console.log(chalk.green(`✅ 通过: BibTeX 格式正确`));
      return true;
    }

    if (format === 'json') {
      const result = JSON.parse(readFileSync(outputFile, 'utf-8'));
      const papers = result.papers || [];

      if (papers.length < test.expect.minResults) {
        console.log(chalk.red(`❌ 失败: 返回 ${papers.length} 篇，期望至少 ${test.expect.minResults} 篇`));
        return false;
      }
      console.log(chalk.green(`✅ 通过: JSON 格式正确，共 ${papers.length} 篇`));
      return true;
    }

    const result = JSON.parse(readFileSync(outputFile, 'utf-8'));
    const papers = result.papers || [];

    const count = papers.length;
    if (count < test.expect.minResults) {
      console.log(chalk.red(`❌ 失败: 返回 ${count} 篇，期望至少 ${test.expect.minResults} 篇`));
      return false;
    }

    if (test.expect.yearMin) {
      const invalidYears = papers.filter(p => p.year && p.year < test.expect.yearMin);
      if (invalidYears.length > 0) {
        console.log(chalk.red(`❌ 失败: 发现 ${invalidYears.length} 篇年份早于 ${test.expect.yearMin}`));
        return false;
      }
    }

    if (test.expect.yearMax) {
      const invalidYears = papers.filter(p => p.year && p.year > test.expect.yearMax);
      if (invalidYears.length > 0) {
        console.log(chalk.red(`❌ 失败: 发现 ${invalidYears.length} 篇年份晚于 ${test.expect.yearMax}`));
        return false;
      }
    }

    console.log(chalk.green(`✅ 通过: ${count} 篇结果符合要求`));
    return true;

  } catch (error) {
    if (error.status === 0) return true;

    console.log(chalk.red(`\n❌ 测试失败:`));
    console.log(chalk.gray(error.stderr || error.message));
    return false;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  console.log(chalk.bold.cyan('\n🧪 lit-search 自动化测试\n'));

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const success = await runTest(test);
    if (success) passed++;
    else failed++;
  }

  console.log(`\n${chalk.bold('━'.repeat(60))}`);
  console.log(chalk.bold('📊 测试总结'));
  console.log('─'.repeat(60));
  console.log(chalk.green(`  ✅ 通过: ${passed}/${tests.length}`));
  if (failed > 0) {
    console.log(chalk.red(`  ❌ 失败: ${failed}/${tests.length}`));
  }
  console.log('━'.repeat(60) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

main();
