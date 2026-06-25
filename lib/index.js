/**
 * lit-search - Programmatic API
 *
 * 在 Node.js 代码中直接调用文献检索功能
 */

import { searchPapers } from './search.js';

/**
 * 搜索学术文献
 * @param {Object} options - 搜索选项
 * @param {string} options.query - 搜索关键词/主题
 * @param {string[]} [options.keywords] - 额外关键词
 * @param {string[]} [options.excludeTerms] - 排除词
 * @param {number} [options.yearStart] - 起始年份
 * @param {number} [options.yearEnd] - 结束年份
 * @param {number} [options.limit=50] - 最大结果数
 * @returns {Promise<Object>} 搜索结果
 */
async function search(options) {
  return await searchPapers({
    query: options.query,
    keywords: options.keywords || [],
    excludeTerms: options.excludeTerms || [],
    yearStart: options.yearStart,
    yearEnd: options.yearEnd,
    limit: options.limit || 50,
    queryExpansion: options.queryExpansion,
    searchScope: options.searchScope,
    engines: options.engines,
    apiKeys: options.apiKeys,
    logger: options.logger,
  });
}

export { search, searchPapers };
export default { search, searchPapers };
