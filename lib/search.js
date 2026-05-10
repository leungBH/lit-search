/**
 * Literature Search Core
 * 
 * 多源检索、去重、过滤、排序
 */

import { SemanticScholarAPI, OpenAlexAPI, ArxivAPI, CrossrefAPI, CoreAPI } from './apis/index.js';
import { resolveLogger } from './logger.js';

const DEFAULT_QUERY_TIMEOUT_MS = 15000;

export async function searchPapers(options) {
  const {
    query,
    keywords = [],
    excludeTerms = [],
    yearStart = null,
    yearEnd = null,
    limit = 5,
    queryExpansion = 'none',
    searchScope = 'default-engine-search',
    logger = null,
    engines = {
      semanticScholar: true,
      openalex: true,
      arxiv: true,
      crossref: true,
      core: true
    },
    apiKeys = {}
  } = options;
  const activeLogger = resolveLogger(logger);

  const yearRange = (yearStart || yearEnd) ? { start: yearStart, end: yearEnd } : null;

  const s2Api = new SemanticScholarAPI(apiKeys.s2, activeLogger);
  const oaApi = new OpenAlexAPI(apiKeys.openalex, activeLogger);
  const arxivApi = new ArxivAPI();
  const crossrefApi = new CrossrefAPI(apiKeys.crossrefMailto, activeLogger);
  const coreApi = new CoreAPI(apiKeys.core, activeLogger);

  const enabledEngines = {
    semanticScholar: engines.semanticScholar !== false,
    openalex: engines.openalex !== false,
    arxiv: engines.arxiv !== false,
    crossref: engines.crossref !== false,
    core: engines.core !== false
  };

  const queries = generateQueries(query, keywords, queryExpansion);
  activeLogger.info(`\n📝 查询关键词 (${queries.length} 个): ${queries.join(', ')}`);
  activeLogger.info(`🧩 查询展开策略: ${describeQueryExpansion(queryExpansion)}`);
  activeLogger.info(`🎛️ 检索范围: ${describeSearchScope(searchScope)}`);

  if (yearRange) {
    activeLogger.info(`📅 年份范围: ${yearRange.start || '...'} - ${yearRange.end || '...'}`);
  }
  activeLogger.info(`🎯 每个关键词检索上限: ${limit} 篇\n`);

  const allPapers = [];
  const engineList = [];

  if (enabledEngines.semanticScholar) engineList.push({ name: 'Semantic Scholar', api: s2Api, method: 'searchPapers' });
  if (enabledEngines.openalex) engineList.push({ name: 'OpenAlex', api: oaApi, method: 'searchWorks' });
  if (enabledEngines.arxiv) engineList.push({ name: 'arXiv', api: arxivApi, method: 'search' });
  if (enabledEngines.crossref) engineList.push({ name: 'CrossRef', api: crossrefApi, method: 'searchWorks' });
  if (enabledEngines.core) engineList.push({ name: 'CORE', api: coreApi, method: 'searchWorks' });

  const engineStats = [];

  for (let i = 0; i < engineList.length; i++) {
    const { name, api, method } = engineList[i];
    activeLogger.info(`[${i + 1}/${engineList.length}] 🔍 ${name}`);

    const enginePapers = [];
    let hasNetworkError = false;
    const queryResults = [];

    for (const q of queries) {
      const controller = new AbortController();
      const queryTimeoutMs = api.queryTimeoutMs || DEFAULT_QUERY_TIMEOUT_MS;
      const timeoutId = setTimeout(() => {
        controller.abort(new Error(`请求超时（${Math.ceil(queryTimeoutMs / 1000)}秒）`));
      }, queryTimeoutMs);

      try {
        const results = await api[method](q, {
          limit,
          yearRange,
          searchScope,
          signal: controller.signal
        });
        const scopedResults = applySearchScope(results, q, searchScope);
        enginePapers.push(...scopedResults);
        activeLogger.info(`   ✅ "${q}" → ${scopedResults.length} 篇`);
        queryResults.push({ query: q, status: 'success', count: scopedResults.length });
      } catch (error) {
        const isNetworkError = error.message.includes('网络') ||
                              error.message.includes('fetch failed') ||
                              error.message.includes('timeout') ||
                              error.message.includes('proxy') ||
                              error.message.includes('代理');
        hasNetworkError = hasNetworkError || isNetworkError;
        activeLogger.info(`   ⚠️ "${q}" 失败: ${error.message}`);
        queryResults.push({ query: q, status: 'failed', error: error.message });
      } finally {
        clearTimeout(timeoutId);
      }

      await new Promise(r => setTimeout(r, 300));
    }

    let filteredPapers = enginePapers;
    if (yearRange) {
      filteredPapers = enginePapers.filter(p => {
        if (!p.year) return true;
        if (yearRange.start && p.year < yearRange.start) return false;
        if (yearRange.end && p.year > yearRange.end) return false;
        return true;
      });

      if (filteredPapers.length !== enginePapers.length) {
        activeLogger.info(`   📅 年份过滤: ${enginePapers.length} → ${filteredPapers.length} 篇`);
      }
    }

    if (filteredPapers.length > 0) {
      allPapers.push(...filteredPapers);
      activeLogger.info(`   ✅ ${name}: ${filteredPapers.length} 篇 (累计: ${allPapers.length})\n`);
      engineStats.push({
        engine: name,
        status: 'success',
        queryResults,
        totalPapers: filteredPapers.length
      });
    } else if (hasNetworkError) {
      activeLogger.info(`   ⚠️ ${name}: 网络错误，请检查网络连接\n`);
      engineStats.push({
        engine: name,
        status: 'network_error',
        queryResults,
        totalPapers: 0
      });
    } else {
      activeLogger.info(`   ⚠️ ${name}: 无结果\n`);
      engineStats.push({
        engine: name,
        status: 'no_results',
        queryResults,
        totalPapers: 0
      });
    }
  }

  if (allPapers.length === 0) {
    activeLogger.warn('\n❌ 所有引擎都未返回结果！');
    activeLogger.info('可能的原因:');
    activeLogger.info('  - 网络连接问题（请检查是否能访问学术API）');
    activeLogger.info('  - 查询词过于特殊');
    activeLogger.info('  - 年份范围过窄');
    activeLogger.info('\n💡 提示: 某些API在部分地区可能需要代理才能访问\n');
  }

  activeLogger.info(`📊 原始检索: ${allPapers.length} 篇`);

  const deduped = deduplicate(allPapers);
  activeLogger.info(`✨ 去重后: ${deduped.length} 篇`);

  const filtered = filterByRelevance(deduped, [...query.split(','), ...keywords], excludeTerms);
  activeLogger.info(`🔍 过滤后: ${filtered.length} 篇`);

  const sorted = sortByRelevance(filtered);

  const outputPapers = sorted.map((p, idx) => toOutputPaper(p, idx + 1));

  activeLogger.info(`\n🎉 最终结果: ${outputPapers.length} 篇\n`);

  return {
    metadata: {
      query,
      keywords: queries,
      queryExpansion,
      searchScope,
      totalRetrieved: allPapers.length,
      afterDedup: deduped.length,
      afterFilter: filtered.length,
      finalCount: outputPapers.length,
      yearRange,
      engines: engineList.map(e => e.name),
      engineStats
    },
    papers: outputPapers
  };
}

function toOutputPaper(paper, seqId) {
  const authorsStr = Array.isArray(paper.authors) 
    ? paper.authors.join(' and ') 
    : (paper.authors || '');

  const keywords = collectList(
    paper.keywords,
    paper.topics,
    paper.fieldsOfStudy
  );

  const identifiers = {
    ...(paper.identifiers || {}),
    arxiv: paper.source === 'arxiv' ? paper.id : (paper.identifiers?.arxiv || null),
    openalex: paper.source === 'openalex' ? paper.id : (paper.identifiers?.openalex || null),
    semanticScholar: paper.source === 'semantic-scholar' ? paper.id : (paper.identifiers?.semanticScholar || null),
    crossref: paper.source === 'crossref' ? paper.id : (paper.identifiers?.crossref || null),
    core: paper.source === 'core' ? paper.id : (paper.identifiers?.core || null)
  };

  return {
    citation_key: generateCitationKey(paper, seqId),
    entry_type: paper.source === 'arxiv' ? 'misc' : 'article',
    title: paper.title || '',
    author: authorsStr,
    authors: Array.isArray(paper.authors) ? paper.authors : (paper.authors ? [paper.authors] : []),
    year: paper.year || null,
    journal: paper.journal || paper.venue || null,
    venue: paper.venue || null,
    booktitle: null,
    volume: paper.volume || null,
    number: paper.issue || null,
    issue: paper.issue || null,
    pages: paper.pages || null,
    first_page: paper.firstPage || null,
    last_page: paper.lastPage || null,
    publisher: paper.publisher || null,
    address: null,
    edition: null,
    month: null,
    note: paper.note || null,
    doi: paper.doi || null,
    url: paper.url || paper.pdfUrl || paper.id || null,
    pdf_url: paper.pdfUrl || null,
    abstract: paper.abstract || null,
    keywords,
    topics: collectList(paper.topics),
    fields_of_study: collectList(paper.fieldsOfStudy, paper.keywords),
    isbn: normalizeIdentifierList(identifiers.isbn),
    issn: normalizeIdentifierList(identifiers.issn),
    lccn: null,
    mr_number: null,
    zbl_number: null,
    arxiv_id: identifiers.arxiv || null,
    openalex_id: identifiers.openalex || null,
    semantic_scholar_id: identifiers.semanticScholar || null,
    crossref_id: identifiers.crossref || null,
    core_id: identifiers.core || null,
    primary_category: paper.primaryCategory || null,
    language: paper.language || null,
    work_type: paper.workType || null,
    identifiers,
    source: paper.source || null,
    citation_count: paper.citationCount || 0,
    relevance_score: paper.relevanceScore || 0,
    seq_id: seqId
  };
}

function generateCitationKey(paper, seqId) {
  const firstAuthor = Array.isArray(paper.authors) && paper.authors.length > 0
    ? paper.authors[0].split(' ').pop() || 'unknown'
    : 'unknown';
  const year = paper.year || 'nd';
  return `${firstAuthor}${year}_${seqId}`;
}

export function generateQueries(query, extraKeywords, queryExpansion = 'none') {
  const queries = [];

  const baseKeywords = query.split(',').map(k => k.trim()).filter(k => k.length > 0);

  if (queryExpansion === 'none') {
    queries.push(...baseKeywords);
  } else if (queryExpansion === 'pairwise') {
    queries.push(...buildPairwiseQueries(baseKeywords));
  } else if (queryExpansion === 'full') {
    queries.push(...buildFullQueries(baseKeywords));
  } else {
    queries.push(...baseKeywords);
  }

  extraKeywords.forEach(kw => {
    if (!queries.includes(kw)) {
      queries.push(kw);
    }
  });

  return [...new Set(queries)];
}

function buildPairwiseQueries(baseKeywords) {
  const queries = [];

  for (let i = 0; i < baseKeywords.length; i++) {
    for (let j = i + 1; j < baseKeywords.length; j++) {
      queries.push(`${baseKeywords[i]} ${baseKeywords[j]}`);
    }
  }

  queries.push(...baseKeywords);
  return queries;
}

function buildFullQueries(baseKeywords) {
  const queries = [];

  for (let size = baseKeywords.length; size >= 2; size--) {
    queries.push(...buildCombinations(baseKeywords, size).map(group => group.join(' ')));
  }

  queries.push(...baseKeywords);
  return queries;
}

function buildCombinations(items, size, start = 0, prefix = [], result = []) {
  if (prefix.length === size) {
    result.push([...prefix]);
    return result;
  }

  for (let i = start; i <= items.length - (size - prefix.length); i++) {
    prefix.push(items[i]);
    buildCombinations(items, size, i + 1, prefix, result);
    prefix.pop();
  }

  return result;
}

function describeQueryExpansion(queryExpansion) {
  const descriptions = {
    none: '仅原始关键词',
    pairwise: '两两组合 + 单关键词',
    full: '所有组合 + 单关键词'
  };

  return descriptions[queryExpansion] || descriptions.none;
}

function describeSearchScope(searchScope) {
  const descriptions = {
    'title-only': '仅标题',
    'title-abstract': '标题 + 摘要',
    'default-engine-search': '使用各文献源默认搜索策略'
  };

  return descriptions[searchScope] || descriptions['default-engine-search'];
}

function applySearchScope(results, query, searchScope) {
  if (searchScope === 'default-engine-search') {
    return results;
  }

  const normalizedQuery = normalizeMatchText(query);
  if (!normalizedQuery) {
    return results;
  }

  return results.filter(paper => {
    const title = normalizeMatchText(paper.title);
    const abstract = normalizeMatchText(paper.abstract);

    if (searchScope === 'title-only') {
      return title.includes(normalizedQuery);
    }

    return title.includes(normalizedQuery) || abstract.includes(normalizedQuery);
  });
}

function normalizeMatchText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function deduplicate(papers) {
  const doiSet = new Set();
  const titleSet = new Set();
  const result = [];

  for (const paper of papers) {
    if (paper.doi) {
      const normalizedDoi = paper.doi.toLowerCase().trim();
      if (doiSet.has(normalizedDoi)) continue;
      doiSet.add(normalizedDoi);
    }

    const normalizedTitle = paper.title.toLowerCase().trim();
    let isDuplicate = false;
    for (const existingTitle of titleSet) {
      if (similarity(normalizedTitle, existingTitle) > 0.85) {
        isDuplicate = true;
        break;
      }
    }

    if (isDuplicate) continue;
    titleSet.add(normalizedTitle);
    result.push(paper);
  }

  return result;
}

function similarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;

  if (longer.length === 0) return 1;

  const editDistance = levenshtein(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshtein(a, b) {
  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function filterByRelevance(papers, keywords, excludeTerms) {
  const normalizedKeywords = keywords
    .map(kw => kw.toLowerCase().trim())
    .filter(Boolean);

  return papers.filter(paper => {
    const title = (paper.title || '').toLowerCase();
    const abstract = (paper.abstract || '').toLowerCase();
    const text = `${title} ${abstract}`;

    for (const term of excludeTerms) {
      if (text.includes(term.toLowerCase())) return false;
    }

    let score = 0;
    for (const kwLower of normalizedKeywords) {
      if (title.includes(kwLower)) score += 3;
      else if (abstract.includes(kwLower)) score += 1;
    }

    paper.relevanceScore = score;

    if (normalizedKeywords.length === 0) {
      return true;
    }

    return score > 0;
  });
}

function sortByRelevance(papers) {
  return papers.sort((a, b) => {
    if (a.relevanceScore !== b.relevanceScore) {
      return (b.relevanceScore || 0) - (a.relevanceScore || 0);
    }
    return (b.citationCount || 0) - (a.citationCount || 0);
  });
}

export default searchPapers;

function collectList(...values) {
  return [...new Set(values.flat().filter(Boolean))];
}

function normalizeIdentifierList(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value].filter(Boolean);
}
