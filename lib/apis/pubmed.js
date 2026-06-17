import { createRequestSignal, isAbortError } from './request-utils.js';

const BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

export class PubMedAPI {
  constructor(apiKey = null, logger = console) {
    this.apiKey = apiKey;
    this.logger = logger;
    this.queryTimeoutMs = 15000;
  }

  async searchWorks(query, options = {}) {
    const { limit = 50, yearRange = null, searchScope = 'default-engine-search', signal = null } = options;
    const ids = await this._searchIds(query, { limit, yearRange, searchScope, signal });
    if (ids.length === 0) return [];
    return this._fetchDetails(ids, signal);
  }

  async _searchIds(query, options) {
    const params = new URLSearchParams({
      db: 'pubmed',
      term: buildPubMedQuery(query, options.searchScope, options.yearRange),
      retmode: 'json',
      retmax: String(Math.min(options.limit, 100)),
      sort: 'relevance'
    });
    if (this.apiKey) params.set('api_key', this.apiKey);
    const data = await this._fetchJson(`${BASE_URL}/esearch.fcgi?${params}`, options.signal);
    return data.esearchresult?.idlist || [];
  }

  async _fetchDetails(ids, signal) {
    const params = new URLSearchParams({
      db: 'pubmed',
      id: ids.join(','),
      retmode: 'xml'
    });
    if (this.apiKey) params.set('api_key', this.apiKey);
    const xml = await this._fetchText(`${BASE_URL}/efetch.fcgi?${params}`, signal);
    return parsePubMedArticles(xml);
  }

  async _fetchJson(url, signal) {
    return JSON.parse(await this._fetchText(url, signal));
  }

  async _fetchText(url, signal) {
    const request = createRequestSignal(signal, this.queryTimeoutMs);
    try {
      const response = await fetch(url, { signal: request.signal });
      if (!response.ok) throw new Error(`PubMed API error: ${response.status}`);
      return await response.text();
    } catch (error) {
      if (isAbortError(error) || request.signal.aborted) {
        if (signal?.aborted) throw new Error('请求已取消');
        throw new Error('请求超时（15秒）');
      }
      throw error;
    } finally {
      request.cleanup();
    }
  }
}

function buildPubMedQuery(query, searchScope, yearRange) {
  const field = searchScope === 'title-only'
    ? 'Title'
    : searchScope === 'title-abstract'
      ? 'Title/Abstract'
      : 'All Fields';
  const parts = [`"${String(query || '').replace(/"/g, '\\"')}"[${field}]`];
  if (yearRange?.start || yearRange?.end) {
    parts.push(`("${yearRange.start || 1800}"[Date - Publication] : "${yearRange.end || 3000}"[Date - Publication])`);
  }
  return parts.join(' AND ');
}

function parsePubMedArticles(xml) {
  const articles = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || [];
  return articles.map(article => {
    const pmid = extractTag(article, 'PMID');
    const title = stripTags(extractTag(article, 'ArticleTitle')) || '';
    const authors = parseAuthors(article);
    const doi = extractArticleId(article, 'doi');
    const pmcid = extractArticleId(article, 'pmc');
    const year = Number(extractTag(article, 'Year') || extractMedlineDate(article)) || null;
    const journal = stripTags(extractTag(article, 'Title')) || extractTag(article, 'ISOAbbreviation') || null;
    const volume = extractTag(article, 'Volume');
    const issue = extractTag(article, 'Issue');
    const pages = normalizePages(extractTag(article, 'MedlinePgn'));
    const abstract = parseAbstract(article);
    return {
      id: pmid || doi || pmcid || null,
      title,
      authors,
      year,
      venue: journal,
      journal,
      publisher: null,
      doi,
      abstract,
      tldr: null,
      citationCount: 0,
      pdfCandidates: collectPubMedPdfCandidates(doi, pmcid),
      url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : (doi ? `https://doi.org/${doi}` : null),
      volume,
      issue,
      pages: pages.pages,
      firstPage: pages.firstPage,
      lastPage: pages.lastPage,
      keywords: parseKeywords(article),
      topics: parseMesh(article),
      language: extractTag(article, 'Language'),
      workType: 'journal-article',
      identifiers: {
        doi,
        pmid,
        pmcid
      },
      source: 'pubmed'
    };
  });
}

function parseAuthors(article) {
  const authorBlocks = article.match(/<Author [\s\S]*?<\/Author>/g) || [];
  return authorBlocks.map(block => {
    const foreName = extractTag(block, 'ForeName');
    const lastName = extractTag(block, 'LastName');
    const collective = extractTag(block, 'CollectiveName');
    return collective || [foreName, lastName].filter(Boolean).join(' ');
  }).filter(Boolean);
}

function parseAbstract(article) {
  const values = Array.from(article.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/gi), match => stripTags(match[1]));
  return values.filter(Boolean).join(' ') || null;
}

function parseKeywords(article) {
  return Array.from(article.matchAll(/<Keyword[^>]*>([\s\S]*?)<\/Keyword>/gi), match => stripTags(match[1])).filter(Boolean);
}

function parseMesh(article) {
  return Array.from(article.matchAll(/<DescriptorName[^>]*>([\s\S]*?)<\/DescriptorName>/gi), match => stripTags(match[1])).filter(Boolean);
}

function extractArticleId(article, type) {
  const match = article.match(new RegExp(`<ArticleId[^>]*IdType="${type}"[^>]*>([\\s\\S]*?)<\/ArticleId>`, 'i'));
  return match ? stripTags(match[1]) : null;
}

function extractMedlineDate(article) {
  const value = extractTag(article, 'MedlineDate');
  const match = String(value || '').match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : null;
}

function extractTag(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\/${tagName}>`, 'i'));
  return match ? stripTags(match[1]) : null;
}

function stripTags(value) {
  if (!value) return null;
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePages(value) {
  const pages = value ? String(value).replace(/--/g, '-') : null;
  if (!pages) return { pages: null, firstPage: null, lastPage: null };
  const [firstPage, lastPage] = pages.split('-').map(item => item.trim()).filter(Boolean);
  return { pages, firstPage: firstPage || null, lastPage: lastPage || null };
}

function collectPubMedPdfCandidates(doi, pmcid) {
  const candidates = [];
  if (pmcid) {
    const clean = String(pmcid).replace(/^PMC/i, '');
    candidates.push({
      source: 'pubmed',
      provider: 'PubMed Central',
      url: `https://pmc.ncbi.nlm.nih.gov/articles/PMC${clean}/pdf/`,
      access_type: 'pmc_oa_pdf',
      license: null,
      is_oa: true,
      confidence: 0.82,
      reason: 'PMCID is available; PubMed Central may provide an open full-text PDF.',
      resolver: 'pubmed.pmcid'
    });
  }
  if (doi) {
    candidates.push({
      source: 'pubmed',
      provider: 'doi.org',
      url: `https://doi.org/${doi}`,
      access_type: 'doi_landing_page',
      license: null,
      is_oa: false,
      confidence: 0.22,
      reason: 'PubMed record has a DOI; DOI landing page is available as manual fallback.',
      resolver: 'doi.landing'
    });
  }
  return candidates;
}

export default PubMedAPI;
