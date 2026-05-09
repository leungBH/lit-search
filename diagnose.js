#!/usr/bin/env node

/**
 * lit-search 诊断工具
 * 帮助排查检索不出结果的问题
 */

import { SemanticScholarAPI } from './lib/apis/semantic-scholar.js';
import { OpenAlexAPI } from './lib/apis/openalex.js';
import { ArxivAPI } from './lib/apis/arxiv.js';
import { CrossrefAPI } from './lib/apis/crossref.js';
import { CoreAPI } from './lib/apis/core.js';
import { createAppConfig, getResolvedApiKeys } from './lib/app-config.js';

const config = createAppConfig();
const apiKeys = getResolvedApiKeys(config);

console.log('\n🔍 lit-search 诊断工具\n');
console.log('=' .repeat(50));

async function testAPI(name, api, method, query, options = {}) {
  console.log(`\n📡 测试 ${name}...`);
  try {
    const startTime = Date.now();
    const results = await api[method](query, options);
    const duration = Date.now() - startTime;
    console.log(`   ✅ 成功！获取 ${results.length} 篇论文 (${duration}ms)`);
    if (results.length > 0) {
      console.log(`   📄 示例: "${results[0].title?.slice(0, 60)}..."`);
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

async function main() {
  const testQuery = 'machine learning';
  const testOptions = { limit: 3 };

  console.log(`\n🎯 测试查询: "${testQuery}"`);
  console.log(`📊 限制数量: ${testOptions.limit} 篇/引擎\n`);

  // 测试各个 API
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

  // 统计
  console.log('\n' + '='.repeat(50));
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

  // 问题诊断
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

  // 网络测试
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

  console.log('\n' + '='.repeat(50));
  console.log('\n✨ 诊断完成！\n');
}

main().catch(console.error);
