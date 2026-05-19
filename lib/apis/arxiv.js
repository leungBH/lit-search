/**
 * arXiv API Client
 * https://info.arxiv.org/help/api/index.html
 */

import https from 'node:https';
import { createRequestSignal, isAbortError } from './request-utils.js';

const BASE_URL = 'https://export.arxiv.org/api/query';
const ARXIV_REQUEST_TIMEOUT_MS = 60000;
const ARXIV_OUTER_TIMEOUT_MS = 210000;
const ARXIV_MAX_RETRIES = 4;
const ARXIV_RATE_LIMIT_DELAY_MS = 3000;
const ARXIV_RETRY_DELAYS_MS = [10000, 30000, 60000, 90000];

export class ArxivAPI {
  constructor() {
    // arXiv 不需要 API Key
    this.queryTimeoutMs = ARXIV_REQUEST_TIMEOUT_MS;
    this.outerQueryTimeoutMs = ARXIV_OUTER_TIMEOUT_MS;
    this.maxRetries = ARXIV_MAX_RETRIES;
  }

  async search(query, options = {}) {
    const { limit = 50, yearRange = null, categories = null, searchScope = 'default-engine-search', signal = null } = options;
    const papers = [];
    let start = 0;
    const batchSize = 100;
    const maxRetries = this.maxRetries;
    let retryCount = 0;

    // 构建搜索查询
    let searchQuery = buildArxivSearchQuery(query, searchScope);
    const dateRangeQuery = buildArxivDateRangeQuery(yearRange);
    if (dateRangeQuery) {
      searchQuery = `(${searchQuery}) AND ${dateRangeQuery}`;
    }

    if (categories && categories.length > 0) {
      const catQuery = categories.map(c => `cat:${c}`).join(' OR ');
      searchQuery = `(${searchQuery}) AND (${catQuery})`;
    }

    while (papers.length < limit) {
      const params = new URLSearchParams({
        search_query: searchQuery,
        start: String(start),
        max_results: String(Math.min(batchSize, limit - papers.length)),
        sortBy: 'relevance',
        sortOrder: 'descending'
      });

      const request = createRequestSignal(signal, this.queryTimeoutMs);
      let response;

      try {
        response = await fetchArxiv(`${BASE_URL}?${params}`, request.signal, this.queryTimeoutMs);
      } catch (error) {
        request.cleanup();
        if (isAbortError(error) || request.signal.aborted) {
          if (signal?.aborted) {
            throw new Error('请求已取消');
          }
          throw new Error(`请求超时（${Math.ceil(this.queryTimeoutMs / 1000)}秒）`);
        }
        retryCount++;
        if (retryCount > maxRetries) {
          throw error;
        }
        await this._sleep(3000);
        continue;
      }

      request.cleanup();

      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          retryCount++;
          if (retryCount > maxRetries) {
            throw new Error(buildArxivHttpError(response));
          }
          await this._sleep(getRetryDelayMs(response, retryCount));
          continue;
        }
        throw new Error(buildArxivHttpError(response));
      }

      const xmlText = response.body;
      const entries = this._parseXML(xmlText);

      if (entries.length === 0) break;

      for (const entry of entries) {
        const paper = this._normalizeEntry(entry);
        
        // 年份过滤
        if (yearRange) {
          if (yearRange.start && paper.year && paper.year < yearRange.start) continue;
          if (yearRange.end && paper.year && paper.year > yearRange.end) continue;
        }

        papers.push(paper);
      }

      retryCount = 0;

      start += entries.length;
      
      // arXiv API 文档建议连续请求之间至少间隔 3 秒。
      await this._sleep(ARXIV_RATE_LIMIT_DELAY_MS);

      if (entries.length < batchSize) break;
    }

    return papers.slice(0, limit);
  }

  _parseXML(xmlText) {
    const entries = [];
    // 简单的 XML 解析（不依赖外部库）
    const entryMatches = xmlText.match(/<entry>([\s\S]*?)<\/entry>/g) || [];

    for (const entryXML of entryMatches) {
      const entry = {
        id: this._extractTag(entryXML, 'id'),
        title: this._extractTag(entryXML, 'title'),
        summary: this._extractTag(entryXML, 'summary'),
        published: this._extractTag(entryXML, 'published'),
        doi: this._extractTag(entryXML, 'arxiv:doi'),
        journalRef: this._extractTag(entryXML, 'arxiv:journal_ref'),
        comment: this._extractTag(entryXML, 'arxiv:comment'),
        authors: []
      };

      // 提取作者
      const authorMatches = entryXML.match(/<author>[\s\S]*?<name>(.*?)<\/name>[\s\S]*?<\/author>/g) || [];
      for (const authorXML of authorMatches) {
        const name = this._extractTag(authorXML, 'name');
        if (name) entry.authors.push(name);
      }

      // 提取 arXiv ID
      const arxivIdMatch = entry.id.match(/arxiv\.org\/abs\/(.+)$/i);
      entry.arxivId = arxivIdMatch ? arxivIdMatch[1] : null;

      const primaryCategoryMatch = entryXML.match(/<arxiv:primary_category[^>]*term="([^"]+)"/i);
      entry.primaryCategory = primaryCategoryMatch ? primaryCategoryMatch[1] : null;

      entry.categories = Array.from(
        entryXML.matchAll(/<category[^>]*term="([^"]+)"/gi),
        match => match[1]
      );

      entries.push(entry);
    }

    return entries;
  }

  _extractTag(xml, tagName) {
    const match = xml.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\/${tagName}>`, 'i'));
    return match ? match[1].trim().replace(/\s+/g, ' ') : null;
  }

  _normalizeEntry(entry) {
    const year = entry.published ? parseInt(entry.published.slice(0, 4)) : null;

    return {
      id: entry.arxivId || entry.id,
      title: entry.title || '',
      authors: entry.authors,
      year,
      venue: 'arXiv',
      journal: entry.journalRef || 'arXiv',
      doi: entry.doi || null,
      abstract: entry.summary,
      tldr: null,
      citationCount: 0,
      pdfCandidates: entry.arxivId ? [{
        source: 'arxiv',
        provider: 'arxiv',
        url: `https://arxiv.org/pdf/${entry.arxivId}.pdf`,
        access_type: 'arxiv',
        license: null,
        is_oa: true,
        confidence: 0.98,
        reason: 'arXiv ID is available; constructed canonical arXiv PDF URL.',
        resolver: 'arxiv.id'
      }] : [],
      url: entry.id || null,
      keywords: entry.categories || [],
      primaryCategory: entry.primaryCategory || null,
      note: entry.comment || null,
      identifiers: {
        arxiv: entry.arxivId || null,
        doi: entry.doi || null
      },
      source: 'arxiv'
    };
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default ArxivAPI;

function buildArxivSearchQuery(query, searchScope) {
  const escapedQuery = query.trim().replace(/"/g, '\\"');

  if (searchScope === 'title-only') {
    return `ti:"${escapedQuery}"`;
  }

  if (searchScope === 'title-abstract') {
    return `(ti:"${escapedQuery}" OR abs:"${escapedQuery}")`;
  }

  return query.trim().replace(/\s+/g, ' ');
}

function buildArxivDateRangeQuery(yearRange) {
  if (!yearRange?.start && !yearRange?.end) {
    return null;
  }

  const start = yearRange.start ? `${yearRange.start}01010000` : '000101010000';
  const end = yearRange.end ? `${yearRange.end}12312359` : '999912312359';
  return `submittedDate:[${start} TO ${end}]`;
}

function fetchArxiv(url, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'lit-search/1.0 (Academic Research Tool)',
        'Accept': 'application/atom+xml, application/xml;q=0.9, */*;q=0.8'
      }
    }, response => {
      let body = '';
      response.setEncoding('utf8');

      response.on('data', chunk => {
        body += chunk;
      });

      response.on('end', () => {
        cleanup();
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode || 0,
          statusText: response.statusMessage || '',
          headers: response.headers,
          body
        });
      });
    });

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    const onAbort = () => {
      request.destroy(signal?.reason || new Error('Request aborted'));
    };

    request.on('error', error => {
      cleanup();
      reject(error);
    });

    const timeoutId = setTimeout(() => {
      request.destroy(new Error(`Request timed out after ${Math.ceil(timeoutMs / 1000)}s`));
    }, timeoutMs);

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    request.end();
  });
}

function getRetryDelayMs(response, retryCount) {
  const retryAfterSeconds = Number(response.headers?.['retry-after']);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }
  return ARXIV_RETRY_DELAYS_MS[Math.min(retryCount - 1, ARXIV_RETRY_DELAYS_MS.length - 1)];
}

function buildArxivHttpError(response) {
  if (response.status === 429) {
    return 'arXiv API error: 429 rate_limited. arXiv is temporarily rejecting requests from this client. Retry later, reduce parallel lit-search runs, or run arXiv searches sequentially.';
  }
  return `arXiv API error: ${response.status}`;
}
