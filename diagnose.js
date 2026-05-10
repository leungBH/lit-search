#!/usr/bin/env node

/**
 * lit-search 诊断工具
 * 帮助排查检索不出结果的问题，检查 API Key 配置、网络连通性、字段返回等
 */

import { SemanticScholarAPI } from './lib/apis/semantic-scholar.js';
import { OpenAlexAPI } from './lib/apis/openalex.js';
import { ArxivAPI } from './lib/apis/arxiv.js';
import { CrossrefAPI } from './lib/apis/crossref.js';
import { CoreAPI } from './lib/apis/core.js';
import { createAppConfig, getResolvedApiKeys, summarizeApiKeySources } from './lib/app-config.js';

const config = createAppConfig();
const apiKeys = getResolvedApiKeys(config);

console.log('\n🔍 lit-search 诊断工具\n');
console.log('='.repeat(60));

/**
 * 检查 API Key 配置状态
 */
function checkApiKeyConfig() {
  console.log('\n🔑 API Key 配置状态:\n');

  const summary = summarizeApiKeySources(config);
  console.log(`   配置文件: ${summary.storedPath}`);

  const keyNames = [
    { label: 'Semantic Scholar', key: 'semanticScholar' },
    { label: 'OpenAlex', key: 'openalex' },
    { label: 'CrossRef mailto', key: 'crossrefMailto' },
    { label: 'CORE', key: 'core' }
  ];

  for (const { label, key } of keyNames) {
    const stored = summary.stored[key] ? '✅ 已存储' : '⬜ 未存储';
    const env = summary.env[key] ? '✅ 已设置' : '⬜ 未设置';
    const resolved = summary.values[key] ? '✅ 已生效' : '⬜ 未生效';
    console.log(`   ${label}:`);
    console.log(`     本机配置: ${stored}  环境变量: ${env}  最终生效: ${resolved}`);
  }

  const hasAnyKey = Object.values(summary.values).some(Boolean);
  if (!hasAnyKey) {
    console.log('\n   ⚠️  未配置任何 API Key，部分数据源可能受速率限制影响');
    console.log('      运行 lit-search init 进行配置，或设置环境变量\n');
  }
}

/**
 * 测试单个 API 的连通性和返回字段
 */
async function testAPI(name, api, method, query, options = {}) {
  console.log(`\n📡 测试 ${name}...`);
  try {
    const startTime = Date.now();
    const results = await api[method](query, options);
    const duration = Date.now() - startTime;
    console.log(`   ✅ 成功！获取 ${results.length} 篇论文 (${duration}ms)`);

    if (results.length > 0) {
      const paper = results[0];
      console.log(`   📄 示例: "${paper.title?.slice(0, 60)}..."`);

      const fields = [
        { label: '标题', key: 'title' },
        { label: '作者', key: 'authors', check: v => Array.isArray(v) && v.length > 0 },
        { label: '年份', key: 'year' },
        { label: '期刊/来源', key: 'journal' },
        { label: 'DOI', key: 'doi' },
        { label: '摘要', key: 'abstract' },
        { label: '引用数', key: 'citationCount' },
        { label: 'PDF链接', key: 'pdfUrl' },
        { label: '卷号', key: 'volume' },
        { label: '期号', key: 'issue' },
        { label: '页码', key: 'pages' },
        { label: '出版商', key: 'publisher' },
        { label: '关键词', key: 'keywords', check: v => Array.isArray(v) && v.length > 0 },
        { label: '语言', key: 'language' },
        { label: '作品类型', key: 'workType' }
      ];

      const fieldResults = [];
      for (const { label, key, check } of fields) {
        const value = paper[key];
        const present = check ? check(value) : (value !== null && value !== undefined && value !== '');
        fieldResults.push(`${present ? '✅' : '⬜'} ${label}`);
      }
      console.log(`   📊 字段返回:`);
      const line1 = fieldResults.slice(0, 5).join('  ');
      const line2 = fieldResults.slice(5, 10).join('  ');
      const line3 = fieldResults.slice(10).join('  ');
      if (line1) console.log(`      ${line1}`);
      if (line2) console.log(`      ${line2}`);
      if (line3) console.log(`      ${line3}`);
    }

    return results;
  } catch (error) {
    console.error(`   ❌ 失败: ${error.message}`);
    if (error.cause) {
      console.error(`      原因: ${error.cause.message || error.cause}`);
    }
    return [];
  }
}

/**
 * 测试不同搜索范围
 */
async function testSearchScopes() {
  console.log('\n🎛️ 搜索范围测试:\n');
  console.log('   使用 OpenAlex 测试不同 searchScope...');

  const oaApi = new OpenAlexAPI(apiKeys.openalex);
  const testQuery = 'machine learning';
  const scopes = ['default-engine-search', 'title-only', 'title-abstract'];

  for (const scope of scopes) {
    try {
      const startTime = Date.now();
      const results = await oaApi.searchWorks(testQuery, { limit: 3, searchScope: scope });
      const duration = Date.now() - startTime;
      console.log(`   ✅ ${scope}: ${results.length} 篇 (${duration}ms)`);
    } catch (error) {
      console.log(`   ❌ ${scope}: ${error.message}`);
    }
  }
}

async function main() {
  const testQuery = 'machine learning';
  const testOptions = { limit: 3 };

  checkApiKeyConfig();

  console.log(`\n🎯 测试查询: "${testQuery}"`);
  console.log(`📊 限制数量: ${testOptions.limit} 篇/引擎\n`);

  const s2Api = new SemanticScholarAPI(apiKeys.s2);
  const oaApi = new OpenAlexAPI(apiKeys.openalex);
  const arxivApi = new ArxivAPI();
  const crossrefApi = new CrossrefAPI(apiKeys.crossrefMailto);
  const coreApi = new CoreAPI(apiKeys.core);

  const s2Results = await testAPI('Semantic Scholar', s2Api, 'searchPapers', testQuery, testOptions);
  const oaResults = await testAPI('OpenAlex', oaApi, 'searchWorks', testQuery, testOptions);
  const arxivResults = await testAPI('arXiv', arxivApi, 'search', testQuery, testOptions);
  const crossrefResults = await testAPI('CrossRef', crossrefApi, 'searchWorks', testQuery, testOptions);
  const coreResults = await testAPI('CORE', coreApi, 'searchWorks', testQuery, testOptions);

  await testSearchScopes();

  console.log('\n' + '='.repeat(60));
  console.log('\n📊 诊断总结:\n');

  const allResults = [
    { name: 'Semantic Scholar', count: s2Results.length },
    { name: 'OpenAlex', count: oaResults.length },
    { name: 'arXiv', count: arxivResults.length },
    { name: 'CrossRef', count: crossrefResults.length },
    { name: 'CORE', count: coreResults.length }
  ];

  let total = 0;
  let successCount = 0;

  for (const result of allResults) {
    const status = result.count > 0 ? '✅' : '❌';
    console.log(`   ${status} ${result.name}: ${result.count} 篇`);
    total += result.count;
    if (result.count > 0) successCount++;
  }

  console.log(`\n   总计: ${total} 篇 (${successCount}/5 个引擎成功)\n`);

  console.log('💡 可能的问题和解决方案:\n');

  if (successCount === 0) {
    console.log('   ❌ 所有 API 都失败，可能是网络问题:');
    console.log('      - 检查网络连接');
    console.log('      - 检查是否需要代理/VPN');
    console.log('      - 检查防火墙设置\n');
  } else if (successCount < 5) {
    console.log('   ⚠️  部分 API 失败，可能的原因:');
    console.log('      - 该 API 可能暂时不可用');
    console.log('      - 触发了速率限制（稍后重试）');
    console.log('      - 需要配置 API Key 以获得更高限额\n');
  } else {
    console.log('   ✅ 所有 API 都正常工作！');
    console.log('      如果使用 CLI 时仍然没有结果，请检查:');
    console.log('      - 是否使用了过于严格的过滤条件（年份、排除词）');
    console.log('      - 是否使用了特殊字符的查询词');
    console.log('      - 尝试简化查询词\n');
  }

  console.log('🌐 网络连接测试:\n');
  const urls = [
    { name: 'Semantic Scholar', url: 'https://api.semanticscholar.org' },
    { name: 'OpenAlex', url: 'https://api.openalex.org' },
    { name: 'arXiv', url: 'http://export.arxiv.org' },
    { name: 'CrossRef', url: 'https://api.crossref.org' },
    { name: 'CORE', url: 'https://api.core.ac.uk' }
  ];

  for (const { name, url } of urls) {
    try {
      const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      console.log(`   ✅ ${name}: ${response.status} (${url})`);
    } catch (error) {
      console.log(`   ❌ ${name}: 无法连接 (${url})`);
      console.log(`      错误: ${error.message}\n`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n✨ 诊断完成！\n');
}

main().catch(console.error);
