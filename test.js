/**
 * lit-search 测试脚本
 * 覆盖所有可选配置项的联网验收测试
 */

import { execFileSync } from 'child_process';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';

const tests = [
  {
    name: '基本搜索（limit=3, year>=2022）',
    args: ['bin/lit-search.js', 'test', '-l', '3', '-s', '2022'],
    expect: { minResults: 1, yearMin: 2022 }
  },
  {
    name: '多关键词搜索',
    args: ['bin/lit-search.js', 'AI, coding', '-l', '5', '-s', '2023'],
    expect: { minResults: 1, yearMin: 2023 }
  },
  {
    name: '无年份限制',
    args: ['bin/lit-search.js', 'machine learning', '-l', '4'],
    expect: { minResults: 1 }
  },
  {
    name: '结束年份测试（year<=2020）',
    args: ['bin/lit-search.js', 'neural network', '-l', '3', '-u', '2020'],
    expect: { minResults: 1, yearMax: 2020 }
  },
  {
    name: '完整年份范围（2020-2024）',
    args: ['bin/lit-search.js', 'deep learning', '-l', '3', '-s', '2020', '-u', '2024'],
    expect: { minResults: 1, yearMin: 2020, yearMax: 2024 }
  },
  {
    name: 'JSON输出格式',
    args: ['bin/lit-search.js', 'transformer', '-l', '2', '-s', '2022', '--format', 'json'],
    expect: { minResults: 1, format: 'json' }
  },
  {
    name: 'BibTeX输出格式',
    args: ['bin/lit-search.js', 'attention mechanism', '-l', '2', '-s', '2023', '--format', 'bib'],
    expect: { minResults: 1, format: 'bib' }
  },
  {
    name: '查询展开-pairwise策略',
    args: ['bin/lit-search.js', 'graph, neural', '-l', '3', '-s', '2022', '--expand', 'pairwise'],
    expect: { minResults: 1, yearMin: 2022 }
  },
  {
    name: '查询展开-full策略',
    args: ['bin/lit-search.js', 'reinforcement, learning', '-l', '3', '-s', '2021', '--expand', 'full'],
    expect: { minResults: 1, yearMin: 2021 }
  },
  {
    name: '检索范围-title-only',
    args: ['bin/lit-search.js', 'computer vision', '-l', '3', '-s', '2022', '--search-scope', 'title-only'],
    expect: { minResults: 1, yearMin: 2022 }
  },
  {
    name: '检索范围-title-abstract',
    args: ['bin/lit-search.js', 'natural language processing', '-l', '3', '-s', '2022', '--search-scope', 'title-abstract'],
    expect: { minResults: 1, yearMin: 2022 }
  }
];

/**
 * 根据查询词和格式在项目目录中查找输出文件
 */
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

/**
 * 验证 JSON 输出的 papers 数组
 */
function validatePapers(papers, expect) {
  const count = papers.length;
  if (count < expect.minResults) {
    return { ok: false, msg: `返回 ${count} 篇，期望至少 ${expect.minResults} 篇` };
  }

  if (expect.yearMin) {
    const invalid = papers.filter(p => p.year && p.year < expect.yearMin);
    if (invalid.length > 0) {
      return { ok: false, msg: `发现 ${invalid.length} 篇年份早于 ${expect.yearMin}` };
    }
  }

  if (expect.yearMax) {
    const invalid = papers.filter(p => p.year && p.year > expect.yearMax);
    if (invalid.length > 0) {
      return { ok: false, msg: `发现 ${invalid.length} 篇年份晚于 ${expect.yearMax}` };
    }
  }

  return { ok: true, msg: `${count} 篇结果符合要求` };
}

/**
 * 运行单个测试用例
 */
async function runTest(test) {
  console.log(`\n${chalk.bold('━'.repeat(60))}`);
  console.log(`📋 测试: ${test.name}`);
  console.log(`   命令: ${process.execPath} ${test.args.join(' ')}`);
  console.log('─'.repeat(60));

  const projectRoot = process.cwd();
  const format = test.expect.format || 'md';
  let outputFile = null;

  try {
    const output = execFileSync(process.execPath, test.args, {
      encoding: 'utf-8',
      cwd: projectRoot,
      timeout: 120000,
      stdio: 'pipe'
    });

    console.log(output);

    outputFile = findOutputFileByQuery(projectRoot, test.args[1], format);

    if (!outputFile) {
      console.log(chalk.red(`❌ 失败: 未找到输出文件 (格式: ${format}, 查询: ${test.args[1]})`));
      const files = readdirSync(projectRoot).filter(f => f.endsWith('.json') || f.endsWith('.bib') || f.endsWith('.md'));
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
      const v = validatePapers(papers, test.expect);
      if (!v.ok) {
        console.log(chalk.red(`❌ 失败: ${v.msg}`));
        return false;
      }
      console.log(chalk.green(`✅ 通过: JSON 格式正确，${v.msg}`));
      return true;
    }

    const result = JSON.parse(readFileSync(outputFile, 'utf-8'));
    const papers = result.papers || [];
    const v = validatePapers(papers, test.expect);
    if (!v.ok) {
      console.log(chalk.red(`❌ 失败: ${v.msg}`));
      return false;
    }
    console.log(chalk.green(`✅ 通过: ${v.msg}`));
    return true;

  } catch (error) {
    if (error.status === 0) return true;

    console.log(chalk.red(`\n❌ 测试失败:`));
    console.log(chalk.gray(error.stderr || error.message));
    return false;
  } finally {
    if (outputFile && existsSync(outputFile)) {
      unlinkSync(outputFile);
    }
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
