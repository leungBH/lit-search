/**
 * Literature Search Core
 *
 * 多源检索、去重、过滤、排序
 */

import {
  SemanticScholarAPI,
  OpenAlexAPI,
  ArxivAPI,
  CrossrefAPI,
  CoreAPI,
  EuropePmcAPI,
  DblpAPI,
  DoajAPI,
  PubMedAPI,
  UnpaywallAPI,
  OpenCitationsAPI,
} from './apis/index.js';
import { resolveLogger } from './logger.js';
import { mergePdfCandidates, normalizePdfCandidates } from './pdf-candidates.js';
import { throwIfCancelled } from './progress.js';
import { createRequestSignal } from './apis/request-utils.js';

const DEFAULT_QUERY_TIMEOUT_MS = 15000;
const SAME_SOURCE_QUERY_DELAY_MS = 1100;

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
      core: true,
      europePmc: true,
      dblp: true,
      doaj: true,
      pubmed: false,
      unpaywall: true,
      openCitations: false,
    },
    relevanceFilter = true,
    apiKeys = {},
    onProgress = null,
    signal = null,
  } = options;
  const activeLogger = resolveLogger(logger);

  const yearRange = yearStart || yearEnd ? { start: yearStart, end: yearEnd } : null;

  const s2Api = new SemanticScholarAPI(apiKeys.s2, activeLogger);
  const oaApi = new OpenAlexAPI(apiKeys.openalex, activeLogger);
  const arxivApi = new ArxivAPI();
  const crossrefApi = new CrossrefAPI(apiKeys.crossrefMailto, activeLogger);
  const coreApi = new CoreAPI(apiKeys.core, activeLogger);
  const europePmcApi = new EuropePmcAPI(activeLogger);
  const dblpApi = new DblpAPI(activeLogger);
  const doajApi = new DoajAPI(activeLogger);
  const pubmedApi = new PubMedAPI(apiKeys.ncbi, activeLogger);
  const unpaywallApi = new UnpaywallAPI(
    apiKeys.unpaywallEmail || apiKeys.crossrefMailto,
    activeLogger
  );
  const openCitationsApi = new OpenCitationsAPI(activeLogger);

  const enabledEngines = {
    semanticScholar: engines.semanticScholar !== false,
    openalex: engines.openalex !== false,
    arxiv: engines.arxiv !== false,
    crossref: engines.crossref !== false,
    core: engines.core !== false,
    europePmc: engines.europePmc !== false,
    dblp: engines.dblp !== false,
    doaj: engines.doaj !== false,
    pubmed: engines.pubmed === true,
    unpaywall: engines.unpaywall !== false,
    openCitations: engines.openCitations === true,
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

  if (enabledEngines.semanticScholar)
    engineList.push({ name: 'Semantic Scholar', api: s2Api, method: 'searchPapers' });
  if (enabledEngines.openalex)
    engineList.push({ name: 'OpenAlex', api: oaApi, method: 'searchWorks' });
  if (enabledEngines.arxiv) engineList.push({ name: 'arXiv', api: arxivApi, method: 'search' });
  if (enabledEngines.crossref)
    engineList.push({ name: 'CrossRef', api: crossrefApi, method: 'searchWorks' });
  if (enabledEngines.core) engineList.push({ name: 'CORE', api: coreApi, method: 'searchWorks' });
  if (enabledEngines.europePmc)
    engineList.push({ name: 'Europe PMC', api: europePmcApi, method: 'searchWorks' });
  if (enabledEngines.dblp) engineList.push({ name: 'DBLP', api: dblpApi, method: 'searchWorks' });
  if (enabledEngines.doaj) engineList.push({ name: 'DOAJ', api: doajApi, method: 'searchWorks' });
  if (enabledEngines.pubmed)
    engineList.push({ name: 'PubMed', api: pubmedApi, method: 'searchWorks' });

  activeLogger.info(
    `🚦 数据源并发: ${engineList.length} 个源同时检索；同一源内关键词串行请求，间隔 ${(SAME_SOURCE_QUERY_DELAY_MS / 1000).toFixed(1)} 秒以降低限流风险\n`
  );

  const engineStates = engineList.map((engine) => ({
    engine,
    papers: [],
    queryResults: [],
    hasNetworkError: false,
  }));

  for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
    // 每个关键词之前先检查父 signal；abort 时直接抛 CANCELLED
    throwIfCancelled(signal, 'Search cancelled by client');

    const q = queries[queryIndex];
    const progressList = activeLogger.startProgressList?.(
      `\n正在检索的关键词：${q}`,
      engineList.map((engine) => engine.name)
    );

    // 报告当前关键词开始（子步骤粒度：queryIndex * engineList.length / totalSteps）
    const totalSteps = queries.length * engineList.length;
    if (onProgress) {
      await onProgress(
        queryIndex * engineList.length,
        totalSteps,
        `关键词 ${queryIndex + 1}/${queries.length}: ${q}`
      );
    }

    const queryOutputs = await Promise.all(
      engineList.map((engine, index) =>
        searchEngineQuery({
          engine,
          index,
          query: q,
          limit,
          yearRange,
          searchScope,
          signal,
        })
      )
    );

    // 每个源完成后：累加结果 + 报告一次进度
    let sourceDoneCount = 0;
    for (const output of queryOutputs) {
      const state = engineStates[output.index];
      state.papers.push(...output.papers);
      state.queryResults.push(output.queryResult);
      state.hasNetworkError = state.hasNetworkError || output.isNetworkError;
      progressList?.update(output.index, formatQueryStatus(output));

      sourceDoneCount++;
      if (onProgress) {
        const stepProgress = queryIndex * engineList.length + sourceDoneCount;
        await onProgress(
          stepProgress,
          totalSteps,
          `${engineList[output.index].name} · ${formatProgressStatus(output)}`
        );
      }

      // 中途有源因为 signal 取消而中断，则立刻抛 CANCELLED，避免继续等其它源
      if (output.isCancelled) {
        throwIfCancelled(signal, 'Search cancelled by client');
      }
    }
    progressList?.end();

    // 一个关键词全部跑完后，再检查一次
    throwIfCancelled(signal, 'Search cancelled by client');

    if (queryIndex < queries.length - 1) {
      await new Promise((r) => setTimeout(r, SAME_SOURCE_QUERY_DELAY_MS));
    }
  }

  const engineOutputs = engineStates.map((state) =>
    finalizeEngineState({
      state,
      yearRange,
      logger: activeLogger,
    })
  );

  for (const output of engineOutputs) {
    allPapers.push(...output.papers);
  }

  const engineStats = engineOutputs.map((output) => output.stat);

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

  const strictFilterKeywords = [...query.split(','), ...keywords];
  let filtered = relevanceFilter
    ? filterByRelevance(deduped, strictFilterKeywords, excludeTerms)
    : deduped;
  let filterMode = 'strict';
  let effectiveFilterKeywords = strictFilterKeywords;

  if (relevanceFilter && filtered.length === 0 && deduped.length > 0) {
    const relaxedFilterKeywords = buildRelaxedFilterKeywords(strictFilterKeywords);
    const relaxedFiltered = filterByRelevance(deduped, relaxedFilterKeywords, excludeTerms);
    if (relaxedFiltered.length > 0) {
      filtered = relaxedFiltered;
      filterMode = 'relaxed';
      effectiveFilterKeywords = relaxedFilterKeywords;
      activeLogger.info(
        `💡 严格过滤无结果，已放宽为单词级关键词过滤: ${relaxedFilterKeywords.join(', ')}`
      );
    }
  }
  activeLogger.info(`🔍 过滤后: ${filtered.length} 篇`);

  const sorted = sortByRelevance(filtered);

  const outputPapers = sorted.map((p, idx) => toOutputPaper(p, idx + 1));

  const enhancementStats = await enhanceOutputPapers(
    outputPapers,
    {
      unpaywall: enabledEngines.unpaywall ? unpaywallApi : null,
      openCitations: enabledEngines.openCitations ? openCitationsApi : null,
    },
    { signal }
  );

  if (onProgress) {
    await onProgress(
      queries.length * engineList.length,
      queries.length * engineList.length,
      `最终结果: ${outputPapers.length} 篇`
    );
  }

  activeLogger.info(`\n🎉 最终结果: ${outputPapers.length} 篇\n`);

  return {
    metadata: {
      query,
      keywords: queries,
      queryExpansion,
      searchScope,
      filterMode,
      filterKeywords: effectiveFilterKeywords,
      totalRetrieved: allPapers.length,
      afterDedup: deduped.length,
      afterFilter: filtered.length,
      finalCount: outputPapers.length,
      yearRange,
      engines: engineList.map((e) => e.name),
      engineStats,
      enhancements: enhancementStats,
    },
    papers: outputPapers,
  };
}

async function searchEngineQuery({
  engine,
  index,
  query,
  limit,
  yearRange,
  searchScope,
  signal = null,
}) {
  const { name, api, method } = engine;
  const queryTimeoutMs = api.outerQueryTimeoutMs || api.queryTimeoutMs || DEFAULT_QUERY_TIMEOUT_MS;
  // 用统一的 createRequestSignal 把父 signal 和本请求超时串起来
  const request = createRequestSignal(signal, queryTimeoutMs);

  try {
    const results = await api[method](query, {
      limit,
      yearRange,
      searchScope,
      signal: request.signal,
    });
    const scopedResults = applySearchScope(results, query, searchScope);
    return {
      index,
      name,
      papers: scopedResults,
      queryResult: { query, status: 'success', count: scopedResults.length },
      isNetworkError: false,
      isCancelled: false,
    };
  } catch (error) {
    const message = error?.message || String(error);
    // 父 signal 中断 → 标记为 cancelled，不当成网络错误
    if ((error?.name === 'AbortError' || error?.code === 'ABORT_ERR') && signal?.aborted) {
      return {
        index,
        name,
        papers: [],
        queryResult: { query, status: 'cancelled', error: 'cancelled by client' },
        isNetworkError: false,
        isCancelled: true,
      };
    }
    const isNetworkError =
      message.includes('网络') ||
      message.includes('fetch failed') ||
      message.includes('timeout') ||
      message.includes('proxy') ||
      message.includes('代理') ||
      message.includes('rate_limited') ||
      message.includes('429');
    return {
      index,
      name,
      papers: [],
      queryResult: { query, status: 'failed', error: message },
      isNetworkError,
      isCancelled: false,
      error: message,
    };
  } finally {
    request.cleanup();
  }
}

function finalizeEngineState({ state, yearRange, logger }) {
  const { engine, papers, queryResults, hasNetworkError } = state;
  const { name } = engine;
  let filteredPapers = papers;
  if (yearRange) {
    filteredPapers = papers.filter((p) => {
      if (!p.year) return true;
      if (yearRange.start && p.year < yearRange.start) return false;
      if (yearRange.end && p.year > yearRange.end) return false;
      return true;
    });

    if (filteredPapers.length !== papers.length) {
      logger.info(`📅 ${name} 年份过滤: ${papers.length} → ${filteredPapers.length} 篇`);
    }
  }

  if (filteredPapers.length > 0) {
    return {
      papers: filteredPapers,
      stat: {
        engine: name,
        status: 'success',
        queryResults,
        totalPapers: filteredPapers.length,
      },
    };
  }

  if (hasNetworkError) {
    return {
      papers: [],
      stat: {
        engine: name,
        status: 'network_error',
        queryResults,
        totalPapers: 0,
      },
    };
  }

  return {
    papers: [],
    stat: {
      engine: name,
      status: 'no_results',
      queryResults,
      totalPapers: 0,
    },
  };
}

function formatQueryStatus(output) {
  if (output.queryResult.status === 'success') {
    return `✅ ${output.queryResult.count} 篇`;
  }
  if (output.isNetworkError) {
    return `⚠️ 网络/限流错误：${output.error}`;
  }
  return `⚠️ 失败：${output.error}`;
}

/**
 * 进度消息专用：更短、更适合实时刷新的 UI。
 */
function formatProgressStatus(output) {
  if (output.isCancelled) return '已取消';
  if (output.queryResult.status === 'success') return `${output.queryResult.count} 篇`;
  if (output.isNetworkError) return '网络错误';
  return '失败';
}

export async function enhanceOutputPapers(
  papers,
  enhancers,
  { signal = null, onProgress = null } = {}
) {
  const stats = {
    unpaywall: { enabled: Boolean(enhancers.unpaywall?.email), attempted: 0, enriched: 0 },
    openCitations: { enabled: Boolean(enhancers.openCitations), attempted: 0, enriched: 0 },
  };

  for (let i = 0; i < papers.length; i++) {
    throwIfCancelled(signal, 'Enhancement cancelled by client');
    const paper = papers[i];
    const doi = paper.doi || paper.identifiers?.doi;
    if (!doi) continue;

    if (enhancers.unpaywall?.email) {
      stats.unpaywall.attempted++;
      const result = await enhancers.unpaywall.fetchByDoi(doi, { signal });
      if (result) {
        paper.oa_status = result.oa_status || paper.oa_status || null;
        paper.is_oa = result.is_oa;
        paper.license = result.license || paper.license || null;
        paper.pdf_candidates = mergePdfCandidates(
          paper.pdf_candidates || [],
          result.pdfCandidates || []
        );
        paper.metadata_sources = {
          ...(paper.metadata_sources || {}),
          open_access: {
            source: 'unpaywall',
            resolver: 'unpaywall.doi',
            confidence: 0.85,
            reason: 'Open access status and locations were enriched by DOI.',
          },
        };
        stats.unpaywall.enriched++;
      }
    }

    if (enhancers.openCitations) {
      stats.openCitations.attempted++;
      const relations = await enhancers.openCitations.fetchCitationRelations(doi, signal);
      if (relations && (relations.references.length || relations.citations.length)) {
        paper.citation_relations = relations;
        paper.metadata_sources = {
          ...(paper.metadata_sources || {}),
          citation_relations: {
            source: 'opencitations',
            resolver: 'opencitations.doi',
            confidence: 0.75,
            reason: 'Citation relations were enriched by DOI.',
          },
        };
        stats.openCitations.enriched++;
      }
    }

    if (onProgress) {
      await onProgress(i + 1, papers.length, `补全 ${i + 1}/${papers.length}`);
    }
  }

  return stats;
}

function toOutputPaper(paper, seqId) {
  const authorsStr = Array.isArray(paper.authors)
    ? paper.authors.join(' and ')
    : paper.authors || '';

  const keywords = collectList(paper.keywords, paper.topics, paper.fieldsOfStudy);

  const identifiers = {
    ...(paper.identifiers || {}),
    arxiv: paper.source === 'arxiv' ? paper.id : paper.identifiers?.arxiv || null,
    openalex: paper.source === 'openalex' ? paper.id : paper.identifiers?.openalex || null,
    semanticScholar:
      paper.source === 'semantic-scholar' ? paper.id : paper.identifiers?.semanticScholar || null,
    crossref: paper.source === 'crossref' ? paper.id : paper.identifiers?.crossref || null,
    core: paper.source === 'core' ? paper.id : paper.identifiers?.core || null,
    europepmc: paper.source === 'europe-pmc' ? paper.id : paper.identifiers?.europepmc || null,
    dblp: paper.source === 'dblp' ? paper.id : paper.identifiers?.dblp || null,
    doaj: paper.source === 'doaj' ? paper.id : paper.identifiers?.doaj || null,
    pmid: paper.identifiers?.pmid || null,
    pmcid: paper.identifiers?.pmcid || null,
  };

  const pdfCandidates = normalizePdfCandidates([
    paper.pdfCandidates || [],
    buildFallbackPdfCandidates(paper),
  ]);

  return {
    citation_key: generateCitationKey(paper, seqId),
    entry_type: paper.source === 'arxiv' ? 'misc' : 'article',
    title: paper.title || '',
    author: authorsStr,
    authors: Array.isArray(paper.authors) ? paper.authors : paper.authors ? [paper.authors] : [],
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
    url: paper.url || paper.id || null,
    pdf_candidates: pdfCandidates,
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
    europe_pmc_id: identifiers.europepmc || null,
    dblp_key: identifiers.dblp || null,
    doaj_id: identifiers.doaj || null,
    pmid: identifiers.pmid || null,
    pmcid: identifiers.pmcid || null,
    primary_category: paper.primaryCategory || null,
    language: paper.language || null,
    work_type: paper.workType || null,
    identifiers,
    source: paper.source || null,
    citation_count: paper.citationCount || 0,
    relevance_score: paper.relevanceScore || 0,
    seq_id: seqId,
  };
}

function buildFallbackPdfCandidates(paper) {
  const candidates = [];
  if (paper.doi) {
    candidates.push({
      source: paper.source || 'unknown',
      provider: 'doi.org',
      url: paper.doi.startsWith('http') ? paper.doi : `https://doi.org/${paper.doi}`,
      access_type: 'doi_landing_page',
      license: null,
      is_oa: false,
      confidence: 0.22,
      reason: 'DOI landing page is available as a manual fallback.',
      resolver: 'doi.landing',
    });
  }
  if (paper.url) {
    candidates.push({
      source: paper.source || 'unknown',
      provider: null,
      url: paper.url,
      access_type: 'browser_fallback',
      license: null,
      is_oa: false,
      confidence: 0.1,
      reason: 'Source landing page is available for manual browser access.',
      resolver: 'browser.fallback',
    });
  }
  return candidates;
}

function generateCitationKey(paper, seqId) {
  const firstAuthor =
    Array.isArray(paper.authors) && paper.authors.length > 0
      ? paper.authors[0].split(' ').pop() || 'unknown'
      : 'unknown';
  const year = paper.year || 'nd';
  return `${firstAuthor}${year}_${seqId}`;
}

export function generateQueries(query, extraKeywords, queryExpansion = 'none') {
  const queries = [];

  const baseKeywords = query
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  if (queryExpansion === 'none') {
    queries.push(...baseKeywords);
  } else if (queryExpansion === 'pairwise') {
    queries.push(...buildPairwiseQueries(baseKeywords));
  } else if (queryExpansion === 'full') {
    queries.push(...buildFullQueries(baseKeywords));
  } else {
    queries.push(...baseKeywords);
  }

  extraKeywords.forEach((kw) => {
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
    queries.push(...buildCombinations(baseKeywords, size).map((group) => group.join(' ')));
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
    full: '所有组合 + 单关键词',
  };

  return descriptions[queryExpansion] || descriptions.none;
}

function describeSearchScope(searchScope) {
  const descriptions = {
    'title-only': '仅标题',
    'title-abstract': '标题 + 摘要',
    'default-engine-search': '使用各文献源默认搜索策略',
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

  return results.filter((paper) => {
    const title = normalizeMatchText(paper.title);
    const abstract = normalizeMatchText(paper.abstract);

    if (searchScope === 'title-only') {
      return title.includes(normalizedQuery);
    }

    return title.includes(normalizedQuery) || abstract.includes(normalizedQuery);
  });
}

function normalizeMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function deduplicate(papers) {
  const doiSet = new Set();
  const titleSet = new Set();
  const result = [];

  for (const paper of papers) {
    if (paper.doi) {
      const normalizedDoi = paper.doi.toLowerCase().trim();
      const existing = result.find(
        (item) => item.doi && item.doi.toLowerCase().trim() === normalizedDoi
      );
      if (existing) {
        mergePaperInto(existing, paper);
        continue;
      }
      doiSet.add(normalizedDoi);
    }

    const normalizedTitle = paper.title.toLowerCase().trim();
    let duplicatePaper = null;
    for (const existingTitle of titleSet) {
      if (similarity(normalizedTitle, existingTitle) > 0.85) {
        duplicatePaper =
          result.find((item) => item.title.toLowerCase().trim() === existingTitle) || null;
        break;
      }
    }

    if (duplicatePaper) {
      mergePaperInto(duplicatePaper, paper);
      continue;
    }
    titleSet.add(normalizedTitle);
    result.push(paper);
  }

  return result;
}

function mergePaperInto(target, source) {
  target.pdfCandidates = mergePdfCandidates(target.pdfCandidates || [], source.pdfCandidates || []);
  target.keywords = collectList(target.keywords, source.keywords);
  target.topics = collectList(target.topics, source.topics);
  target.fieldsOfStudy = collectList(target.fieldsOfStudy, source.fieldsOfStudy);
  target.identifiers = {
    ...(target.identifiers || {}),
    ...(source.identifiers || {}),
  };
  if (!target.abstract && source.abstract) target.abstract = source.abstract;
  if (!target.journal && source.journal) target.journal = source.journal;
  if (!target.venue && source.venue) target.venue = source.venue;
  if (!target.pages && source.pages) target.pages = source.pages;
  if (!target.volume && source.volume) target.volume = source.volume;
  if (!target.issue && source.issue) target.issue = source.issue;
  if ((source.citationCount || 0) > (target.citationCount || 0)) {
    target.citationCount = source.citationCount;
  }
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
  const normalizedKeywords = keywords.map((kw) => kw.toLowerCase().trim()).filter(Boolean);

  return papers.filter((paper) => {
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

function buildRelaxedFilterKeywords(keywords) {
  const stopwords = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'by',
    'for',
    'from',
    'in',
    'is',
    'of',
    'on',
    'or',
    'the',
    'to',
    'with',
    'using',
    'based',
    'via',
  ]);

  return [
    ...new Set(
      keywords
        .flatMap((keyword) => String(keyword || '').split(/\s+/))
        .map((keyword) => keyword.toLowerCase().trim())
        .filter((keyword) => keyword.length > 2 && !stopwords.has(keyword))
    ),
  ];
}

function sortByRelevance(papers) {
  return papers.sort((a, b) => {
    if (a.relevanceScore !== b.relevanceScore) {
      return (b.relevanceScore || 0) - (a.relevanceScore || 0);
    }
    return (b.citationCount || 0) - (a.citationCount || 0);
  });
}

function collectList(...values) {
  return [...new Set(values.flat().filter(Boolean))];
}

function normalizeIdentifierList(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value].filter(Boolean);
}
