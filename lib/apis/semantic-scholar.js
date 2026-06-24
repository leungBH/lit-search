/**
 * Semantic Scholar API Client
 * https://api.semanticscholar.org/api-docs/
 */

import { createRequestSignal, isAbortError } from './request-utils.js';

const BASE_URL = 'https://api.semanticscholar.org/graph/v1';
const SEARCH_FIELD_SETS = [
  [
    'paperId', 'title', 'abstract', 'year', 'authors',
    'venue', 'publicationVenue', 'openAccessPdf',
    'citationCount', 'tldr', 'externalIds',
    'journal', 'fieldsOfStudy', 'publicationTypes', 'url'
  ].join(','),
  [
    'paperId', 'title', 'abstract', 'year', 'authors',
    'venue', 'publicationVenue', 'openAccessPdf',
    'citationCount', 'externalIds', 'journal', 'url'
  ].join(','),
  [
    'paperId', 'title', 'year', 'authors',
    'venue', 'externalIds', 'url'
  ].join(',')
];
const DETAIL_FIELDS = SEARCH_FIELD_SETS[0];
const DEFAULT_SUCCESS_DELAY_MS = 1100;
const DEFAULT_RATE_LIMIT_DELAY_MS = 60000;

export class SemanticScholarAPI {
  constructor(apiKey = null, logger = console) {
    this.apiKey = apiKey;
    this.logger = logger;
    this.paginationDelayMs = DEFAULT_SUCCESS_DELAY_MS;
  }

  async searchPapers(query, options = {}) {
    const { limit = 50, yearRange = null, signal = null } = options;
    const papers = [];
    let offset = 0;
    const batchSize = 100;
    const maxRetries = 2;

    let retryCount = 0;
    let fieldSetIndex = 0;

    while (papers.length < limit && retryCount <= maxRetries) {
      try {
        const params = new URLSearchParams({
          query,
          fields: SEARCH_FIELD_SETS[fieldSetIndex],
          limit: String(Math.min(batchSize, limit - papers.length)),
          offset: String(offset)
        });

        if (yearRange) {
          const yearFilter = formatSemanticScholarYearRange(yearRange);
          if (yearFilter) {
            params.set('year', yearFilter);
          }
        }

        const headers = {
          'User-Agent': 'lit-search/1.0 (Academic Research Tool)',
          'Accept': 'application/json'
        };
        if (this.apiKey) {
          headers['x-api-key'] = this.apiKey;
        }

        const request = createRequestSignal(signal, 15000);

        try {
          const response = await fetch(`${BASE_URL}/paper/search?${params}`, { 
            headers,
            signal: request.signal
          });

          if (!response.ok) {
            if (response.status >= 500 && fieldSetIndex < SEARCH_FIELD_SETS.length - 1) {
              fieldSetIndex++;
              retryCount = 0;
              this.logger.info(`    ↪ Semantic Scholar 返回 ${response.status}，尝试精简字段重试...`);
              await this._sleep(1200);
              continue;
            }

            if (response.status === 429 || response.status >= 500) {
              retryCount++;
              if (retryCount > maxRetries) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
              }
              const retryDelay = response.status === 429
                ? this._handleRateLimit(response)
                : 2000;
              await this._sleep(retryDelay);
              continue;
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const data = await response.json();
          const results = data.data || [];

          if (results.length === 0) break;

          for (const paper of results) {
            papers.push(this._normalizePaper(paper));
          }

          offset += results.length;
          fieldSetIndex = 0;
          retryCount = 0; // 成功后重置重试计数
          await this._sleep(this.paginationDelayMs);

          if (results.length < batchSize) break;

        } catch (fetchError) {
          if (isAbortError(fetchError) || request.signal.aborted) {
            if (signal?.aborted) {
              throw new Error('请求已取消');
            }
            throw new Error('请求超时（15秒）');
          }
          throw fetchError;
        } finally {
          request.cleanup();
        }

      } catch (error) {
        if (error.message.includes('超时') || error.message.includes('取消')) {
          throw error;
        }
        
        // 网络错误处理
        const isNetworkError = error.message.includes('fetch failed') || 
                               error.message.includes('network') ||
                               error.message.includes('ECONNREFUSED') ||
                               error.message.includes('ENOTFOUND');
        
        if (isNetworkError && retryCount < maxRetries) {
          retryCount++;
          this.logger.info(`    🔄 网络错误，重试 ${retryCount}/${maxRetries}...`);
          await this._sleep(2000);
          continue;
        }
        
        // 其他错误或重试次数用完
        if (isNetworkError) {
          throw new Error('网络连接失败（可能需要代理）');
        }
        
        this.logger.info(`    ❌ 错误: ${error.message}`);
        break;
      }
    }

    return await this._enrichPapers(papers.slice(0, limit), signal);
  }

  async _enrichPapers(papers, signal) {
    const paperIds = papers.map(paper => paper.id).filter(Boolean);
    if (!paperIds.length) return papers;

    const headers = {
      'User-Agent': 'lit-search/1.0 (Academic Research Tool)',
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    const request = createRequestSignal(signal, 15000);

    try {
      const response = await fetch(`${BASE_URL}/paper/batch?fields=${encodeURIComponent(DETAIL_FIELDS)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ids: paperIds }),
        signal: request.signal
      });

      if (!response.ok) {
        if (response.status === 429) {
          const retryDelay = this._handleRateLimit(response);
          this.logger.info(`    ↪ Semantic Scholar 详情接口限流，跳过详情补全；建议 ${Math.ceil(retryDelay / 1000)} 秒后重试`);
        }
        if (response.status >= 500) {
          this.logger.info(`    ↪ Semantic Scholar 详情接口暂时不可用（HTTP ${response.status}），跳过详情补全`);
        }
        return papers;
      }

      const detailResults = await response.json();
      const detailMap = new Map(
        (detailResults || [])
          .filter(detail => detail?.paperId)
          .map(detail => [detail.paperId, this._normalizePaper(detail)])
      );

      return papers.map(paper => mergePaperDetails(paper, detailMap.get(paper.id)));
    } catch (error) {
      if (isAbortError(error) || request.signal.aborted) {
        return papers;
      }
      return papers;
    } finally {
      request.cleanup();
    }
  }

  async fetchPaper(identifier, signal) {
    if (!identifier) return null;

    const headers = {
      'User-Agent': 'lit-search/1.0 (Academic Research Tool)',
      'Accept': 'application/json'
    };
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    const request = createRequestSignal(signal, 15000);
    try {
      const response = await fetch(`${BASE_URL}/paper/${encodeURIComponent(identifier)}?fields=${encodeURIComponent(DETAIL_FIELDS)}`, {
        headers,
        signal: request.signal
      });
      if (!response.ok) return null;
      return this._normalizePaper(await response.json());
    } catch {
      return null;
    } finally {
      request.cleanup();
    }
  }

  async fetchPaperByDoi(doi, signal) {
    if (!doi) return null;
    return this.fetchPaper(`DOI:${normalizeDoi(doi)}`, signal);
  }

  /**
   * Look up a single paper by DOI. Returns normalized paper or null.
   * Throws on 404 so the orchestrator can try a fallback source.
   */
  async lookupByDoi(doi, { signal } = {}) {
    if (!doi) return null;
    const headers = {
      'User-Agent': 'lit-search/1.0 (Academic Research Tool)',
      'Accept': 'application/json'
    };
    if (this.apiKey) headers['x-api-key'] = this.apiKey;
    const request = createRequestSignal(signal, 15000);
    try {
      const response = await fetch(
        `${BASE_URL}/paper/DOI:${encodeURIComponent(normalizeDoi(doi))}?fields=${encodeURIComponent(DETAIL_FIELDS)}`,
        { headers, signal: request.signal }
      );
      if (response.status === 404) {
        const e = new Error('Semantic Scholar: not found');
        e.status = 404;
        e.source = 'semantic-scholar';
        throw e;
      }
      if (!response.ok) {
        const e = new Error(`Semantic Scholar lookup error: ${response.status}`);
        e.status = response.status;
        e.source = 'semantic-scholar';
        throw e;
      }
      return this._normalizePaper(await response.json());
    } finally {
      request.cleanup();
    }
  }

  /**
   * Look up a single paper by title. Returns the best match or null.
   * Throws on network errors and 429 (rate limited).
   */
  async lookupByTitle(title, { signal } = {}) {
    if (!title) return null;
    const headers = {
      'User-Agent': 'lit-search/1.0 (Academic Research Tool)',
      'Accept': 'application/json'
    };
    if (this.apiKey) headers['x-api-key'] = this.apiKey;
    const params = new URLSearchParams({
      query: title,
      fields: DETAIL_FIELDS,
      limit: '1'
    });
    const request = createRequestSignal(signal, 15000);
    try {
      const response = await fetch(`${BASE_URL}/paper/search?${params}`, { headers, signal: request.signal });
      if (response.status === 404) {
        const e = new Error('Semantic Scholar: not found');
        e.status = 404;
        e.source = 'semantic-scholar';
        throw e;
      }
      if (!response.ok) {
        const e = new Error(`Semantic Scholar lookup error: ${response.status}`);
        e.status = response.status;
        e.source = 'semantic-scholar';
        throw e;
      }
      const data = await response.json();
      const first = (data.data || [])[0];
      return first ? this._normalizePaper(first) : null;
    } finally {
      request.cleanup();
    }
  }

  _normalizePaper(paper) {
    const normalizedPages = normalizePages(paper.journal?.pages || null);
    const pdfCandidates = [];
    if (paper.openAccessPdf?.url) {
      pdfCandidates.push({
        source: 'semantic-scholar',
        provider: 'semantic-scholar',
        url: paper.openAccessPdf.url,
        access_type: null,
        license: null,
        is_oa: true,
        confidence: 0.78,
        reason: 'Semantic Scholar openAccessPdf.url was provided for this paper.',
        resolver: 'semantic-scholar.openAccessPdf'
      });
    }

    return {
      id: paper.paperId || null,
      title: paper.title || '',
      authors: (paper.authors || []).map(a => a.name || '').filter(Boolean),
      year: paper.year || null,
      venue: paper.venue || paper.publicationVenue?.name || '',
      journal: paper.journal?.name || paper.venue || paper.publicationVenue?.name || '',
      doi: paper.externalIds?.DOI || null,
      abstract: paper.abstract || null,
      tldr: paper.tldr?.text || null,
      citationCount: paper.citationCount || 0,
      pdfCandidates,
      url: paper.url || null,
      volume: paper.journal?.volume || null,
      issue: paper.journal?.issue || null,
      pages: normalizedPages.pages,
      firstPage: normalizedPages.firstPage,
      lastPage: normalizedPages.lastPage,
      keywords: Array.isArray(paper.fieldsOfStudy) ? paper.fieldsOfStudy.filter(Boolean) : [],
      workType: Array.isArray(paper.publicationTypes) ? paper.publicationTypes[0] || null : null,
      identifiers: paper.externalIds || {},
      source: 'semantic-scholar'
    };
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _handleRateLimit(response) {
    const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after')) || DEFAULT_RATE_LIMIT_DELAY_MS;
    this.paginationDelayMs = Math.max(this.paginationDelayMs, retryAfterMs);
    this.logger.info(`    ↪ Semantic Scholar 触发限流（HTTP 429），按 Retry-After 等待 ${Math.ceil(retryAfterMs / 1000)} 秒并临时放慢后续请求`);
    return retryAfterMs;
  }
}

export function parseRetryAfterMs(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function formatSemanticScholarYearRange(yearRange) {
  if (!yearRange) return null;

  if (yearRange.start && yearRange.end) {
    return `${yearRange.start}-${yearRange.end}`;
  }

  if (yearRange.start) {
    return `${yearRange.start}-`;
  }

  if (yearRange.end) {
    return `-${yearRange.end}`;
  }

  return null;
}

function normalizePages(pagesValue) {
  if (!pagesValue) {
    return { pages: null, firstPage: null, lastPage: null };
  }

  const match = pagesValue.match(/^([^-\u2013]+)\s*[-\u2013]\s*([^-\u2013]+)$/);
  if (match) {
    return {
      pages: pagesValue,
      firstPage: match[1].trim(),
      lastPage: match[2].trim()
    };
  }

  return {
    pages: pagesValue,
    firstPage: pagesValue,
    lastPage: null
  };
}

export default SemanticScholarAPI;

function mergePaperDetails(basePaper, detailPaper) {
  if (!detailPaper) return basePaper;

  return {
    ...basePaper,
    ...detailPaper,
    authors: preferArray(detailPaper.authors, basePaper.authors),
    keywords: preferArray(detailPaper.keywords, basePaper.keywords),
    pdfCandidates: preferArray(detailPaper.pdfCandidates, basePaper.pdfCandidates),
    identifiers: {
      ...(basePaper.identifiers || {}),
      ...(detailPaper.identifiers || {})
    }
  };
}

function preferArray(primary, fallback) {
  return Array.isArray(primary) && primary.length ? primary : (Array.isArray(fallback) ? fallback : []);
}

function normalizeDoi(value) {
  return String(value || '')
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .trim();
}
