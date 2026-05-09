/**
 * CORE API Client
 * https://api.core.ac.uk/docs/v3
 * 使用 v3 API（最新版本）
 */

import { createRequestSignal, isAbortError } from './request-utils.js';

const BASE_URL = 'https://api.core.ac.uk/v3/search/works';

export class CoreAPI {
  constructor(apiKey = null, logger = console) {
    this.apiKey = apiKey;
    this.logger = logger;
  }

  async searchWorks(query, options = {}) {
    const { limit = 50, yearRange = null, signal = null } = options;
    const papers = [];
    let offset = 0;
    const maxRetries = 2;
    let retryCount = 0;

    while (papers.length < limit) {
      try {
        const pageSize = Math.min(100, limit - papers.length);

        // 构建查询
        let searchQuery = query;

        // 添加年份过滤到查询中
        if (yearRange) {
          if (yearRange.start && yearRange.end) {
            searchQuery += ` AND yearPublished>=${yearRange.start} AND yearPublished<=${yearRange.end}`;
          } else if (yearRange.start) {
            searchQuery += ` AND yearPublished>=${yearRange.start}`;
          } else if (yearRange.end) {
            searchQuery += ` AND yearPublished<=${yearRange.end}`;
          }
        }

        const params = new URLSearchParams({
          q: searchQuery,
          limit: String(pageSize),
          offset: String(offset)
        });

        const headers = {};
        if (this.apiKey) {
          headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const request = createRequestSignal(signal, 30000);
        let response;

        try {
          response = await fetch(`${BASE_URL}?${params}`, {
            headers,
            signal: request.signal
          });
        } catch (fetchError) {
          if (isAbortError(fetchError) || request.signal.aborted) {
            if (signal?.aborted) {
              throw new Error('请求已取消');
            }
            throw new Error('请求超时（30秒）');
          }
          throw fetchError;
        } finally {
          request.cleanup();
        }

        if (!response.ok) {
          if (response.status === 429 || response.status >= 500) {
            retryCount++;
            if (retryCount > maxRetries) {
              throw new Error(`CORE API error: ${response.status} ${response.statusText}`);
            }
            await this._sleep(2000);
            continue;
          }
          throw new Error(`CORE API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const results = data.results || [];

        if (results.length === 0) break;

        for (const work of results) {
          papers.push(this._normalizeWork(work));
        }

        offset += results.length;
        retryCount = 0;
        await this._sleep(this.apiKey ? 100 : 1000);

        if (results.length < pageSize) break;

      } catch (error) {
        if (error.message.includes('超时') || error.message.includes('取消')) {
          throw error;
        }
        this.logger.info(`    CORE 查询失败: ${error.message}`);
        break;
      }
    }

    return papers.slice(0, limit);
  }

  _normalizeWork(work) {
    const authors = (work.authors || [])
      .map(a => a.name || '')
      .filter(Boolean);

    return {
      id: work.id || null,
      title: work.title || '',
      authors,
      year: work.yearPublished || null,
      venue: work.publisher || '',
      journal: work.publisher || null,
      publisher: work.publisher || null,
      doi: work.doi || null,
      abstract: work.abstract || null,
      tldr: null,
      citationCount: work.citationCount || 0,
      pdfUrl: work.downloadUrl || null,
      url: Array.isArray(work.outputs) ? work.outputs[0] || null : null,
      keywords: normalizeFieldOfStudy(work.fieldOfStudy),
      workType: work.documentType || null,
      identifiers: {
        core: work.id || null,
        doi: work.doi || null,
        arxiv: work.arxivId || null
      },
      source: 'core'
    };
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

function normalizeFieldOfStudy(fieldOfStudy) {
  if (!fieldOfStudy) return [];
  if (Array.isArray(fieldOfStudy)) {
    return fieldOfStudy.filter(Boolean);
  }
  return [fieldOfStudy].filter(Boolean);
}

export default CoreAPI;
