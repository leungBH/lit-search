/**
 * CrossRef API Client
 * https://api.crossref.org
 */

import { createRequestSignal, isAbortError } from './request-utils.js';

const BASE_URL = 'https://api.crossref.org/works';

export class CrossrefAPI {
  constructor(mailto = null, logger = console) {
    this.mailto = mailto || 'lit-search@example.com';
    this.logger = logger;
  }

  async searchWorks(query, options = {}) {
    const { limit = 50, yearRange = null, searchScope = 'default-engine-search', signal = null } = options;
    const papers = [];
    let offset = 0;
    const batchSize = 100;
    const maxRetries = 1;

    let retryCount = 0;

    while (papers.length < limit && retryCount <= maxRetries) {
      try {
        const headers = {
          'User-Agent': `lit-search/1.0 (mailto:${this.mailto})`,
          'Accept': 'application/json'
        };

        const params = new URLSearchParams({
          rows: String(Math.min(batchSize, limit - papers.length)),
          offset: String(offset),
          sort: 'relevance',
          order: 'desc',
          mailto: this.mailto
        });

        if (searchScope === 'title-only') {
          params.set('query.title', query);
        } else {
          params.set('query.bibliographic', query);
        }

        // 年份过滤
        if (yearRange?.start || yearRange?.end) {
          const filterParts = [];
          if (yearRange.start) filterParts.push(`from-pub-date:${yearRange.start}`);
          if (yearRange.end) filterParts.push(`until-pub-date:${yearRange.end}`);
          params.set('filter', filterParts.join(','));
        }

        const request = createRequestSignal(signal, 15000);

        try {
          const response = await fetch(`${BASE_URL}?${params}`, { 
            headers,
            signal: request.signal
          });

          if (!response.ok) {
            if (response.status === 429 || response.status >= 500) {
              retryCount++;
              if (retryCount > maxRetries) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
              }
              await this._sleep(2000);
              continue;
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const data = await response.json();
          const items = data.message?.items || [];

          if (items.length === 0) break;

          for (const item of items) {
            papers.push(this._normalizeItem(item));
          }

          offset += items.length;
          retryCount = 0;
          await this._sleep(500);

          if (items.length < batchSize) break;

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
        
        if (isNetworkError) {
          throw new Error('网络连接失败（可能需要代理）');
        }
        
        this.logger.info(`    ❌ 错误: ${error.message}`);
        break;
      }
    }

    return papers.slice(0, limit);
  }

  _normalizeItem(item) {
    const dateParts = item.published?.['date-parts']?.[0] ||
      item.published_print?.['date-parts']?.[0] ||
      item.published_online?.['date-parts']?.[0] || [];
    const year = dateParts[0] || null;

    const authors = (item.author || [])
      .map(a => {
        const given = a.given || '';
        const family = a.family || '';
        return `${given} ${family}`.trim();
      })
      .filter(Boolean);

    const venue = item['container-title']?.[0] || item.publisher || '';
    const doi = item.DOI || null;
    const normalizedPages = normalizePageRange(item.page || null);
    const subjects = Array.isArray(item.subject) ? item.subject.filter(Boolean) : [];
    const pdfCandidates = collectCrossrefPdfCandidates(item, doi);

    return {
      id: doi ? `doi:${doi}` : null,
      title: item.title?.[0] || '',
      authors,
      year,
      venue,
      journal: item['container-title']?.[0] || null,
      publisher: item.publisher || null,
      doi,
      abstract: stripTags(item.abstract || null),
      tldr: null,
      citationCount: item['is-referenced-by-count'] || 0,
      pdfCandidates,
      url: item.resource?.primary?.URL || item.URL || null,
      volume: item.volume || null,
      issue: item.issue || null,
      pages: normalizedPages.pages,
      firstPage: normalizedPages.firstPage,
      lastPage: normalizedPages.lastPage,
      keywords: subjects,
      language: item.language || null,
      workType: item.type || null,
      identifiers: {
        doi,
        issn: item.ISSN || null,
        isbn: item.ISBN || null
      },
      source: 'crossref'
    };
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Look up a single work by DOI. Returns normalized paper or null.
   * Throws on 404 so the orchestrator can try a fallback source.
   */
  async lookupByDoi(doi, { signal } = {}) {
    if (!doi) return null;
    const headers = {
      'User-Agent': `lit-search/1.0 (mailto:${this.mailto})`,
      'Accept': 'application/json'
    };
    const request = createRequestSignal(signal, 15000);
    try {
      const response = await fetch(`${BASE_URL}/${encodeURIComponent(normalizeDoi(doi))}`, {
        headers,
        signal: request.signal
      });
      if (response.status === 404) {
        const e = new Error('CrossRef: not found');
        e.status = 404;
        e.source = 'crossref';
        throw e;
      }
      if (!response.ok) {
        const e = new Error(`CrossRef lookup error: ${response.status}`);
        e.status = response.status;
        e.source = 'crossref';
        throw e;
      }
      const data = await response.json();
      const item = data.message;
      return item ? this._normalizeItem(item) : null;
    } finally {
      request.cleanup();
    }
  }

  /**
   * Look up a single work by title. Returns the best match or null.
   * Throws on network errors.
   */
  async lookupByTitle(title, { signal } = {}) {
    if (!title) return null;
    const headers = {
      'User-Agent': `lit-search/1.0 (mailto:${this.mailto})`,
      'Accept': 'application/json'
    };
    const params = new URLSearchParams({
      'query.bibliographic': title,
      rows: '1',
      mailto: this.mailto
    });
    const request = createRequestSignal(signal, 15000);
    try {
      const response = await fetch(`${BASE_URL}?${params}`, { headers, signal: request.signal });
      if (response.status === 404) {
        const e = new Error('CrossRef: not found');
        e.status = 404;
        e.source = 'crossref';
        throw e;
      }
      if (!response.ok) {
        const e = new Error(`CrossRef lookup error: ${response.status}`);
        e.status = response.status;
        e.source = 'crossref';
        throw e;
      }
      const data = await response.json();
      const items = data.message?.items || [];
      return items[0] ? this._normalizeItem(items[0]) : null;
    } finally {
      request.cleanup();
    }
  }
}

function collectCrossrefPdfCandidates(item, doi) {
  const candidates = [];
  for (const link of item.link || []) {
    if (!link?.URL) continue;
    const contentType = String(link['content-type'] || '').toLowerCase();
    const intendedApplication = String(link['intended-application'] || '').toLowerCase();
    const looksPdf = contentType.includes('pdf') || /\.pdf($|[?#])/i.test(link.URL);
    if (!looksPdf) continue;

    candidates.push({
      source: 'crossref',
      provider: safeHostname(link.URL) || 'crossref',
      url: link.URL,
      access_type: 'crossref_pdf_link',
      license: null,
      is_oa: false,
      confidence: intendedApplication === 'text-mining' ? 0.58 : 0.52,
      reason: `CrossRef link metadata advertises a PDF content type${intendedApplication ? ` for ${intendedApplication}` : ''}.`,
      resolver: 'crossref.link'
    });
  }

  if (doi) {
    candidates.push({
      source: 'crossref',
      provider: 'doi.org',
      url: `https://doi.org/${doi}`,
      access_type: 'doi_landing_page',
      license: null,
      is_oa: false,
      confidence: 0.22,
      reason: 'DOI landing page is available as a manual fallback.',
      resolver: 'doi.landing'
    });
  }

  return candidates;
}

function safeHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function stripTags(value) {
  if (!value) return null;
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
}

function normalizePageRange(pageValue) {
  if (!pageValue) {
    return { pages: null, firstPage: null, lastPage: null };
  }

  const match = pageValue.match(/^([^-\u2013]+)\s*[-\u2013]\s*([^-\u2013]+)$/);
  if (match) {
    return {
      pages: pageValue,
      firstPage: match[1].trim(),
      lastPage: match[2].trim()
    };
  }

  return {
    pages: pageValue,
    firstPage: pageValue,
    lastPage: null
  };
}

export default CrossrefAPI;
