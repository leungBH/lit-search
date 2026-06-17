import { createRequestSignal, isAbortError } from './request-utils.js';

const BASE_URL = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';

export class EuropePmcAPI {
  constructor(logger = console) {
    this.logger = logger;
    this.queryTimeoutMs = 15000;
  }

  async searchWorks(query, options = {}) {
    const { limit = 50, yearRange = null, searchScope = 'default-engine-search', signal = null } = options;
    const params = new URLSearchParams({
      query: buildEuropePmcQuery(query, yearRange, searchScope),
      format: 'json',
      pageSize: String(Math.min(limit, 100)),
      resultType: 'core'
    });
    const request = createRequestSignal(signal, this.queryTimeoutMs);

    try {
      const response = await fetch(`${BASE_URL}?${params}`, { signal: request.signal });
      if (!response.ok) throw new Error(`Europe PMC API error: ${response.status}`);
      const data = await response.json();
      return (data.resultList?.result || []).slice(0, limit).map(item => this._normalizeItem(item));
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

  _normalizeItem(item) {
    const authors = parseAuthors(item.authorString);
    const doi = item.doi || null;
    const pmid = item.pmid || null;
    const pmcid = item.pmcid || null;
    const pdfCandidates = collectEuropePmcPdfCandidates(item);
    return {
      id: pmid || pmcid || doi || item.id || null,
      title: item.title || '',
      authors,
      year: item.pubYear ? Number(item.pubYear) : null,
      venue: item.journalTitle || null,
      journal: item.journalTitle || null,
      publisher: null,
      doi,
      abstract: item.abstractText || null,
      tldr: null,
      citationCount: Number(item.citedByCount || 0),
      pdfCandidates,
      url: item.fullTextUrlList?.fullTextUrl?.[0]?.url ||
        (pmcid ? `https://europepmc.org/article/PMC/${pmcid.replace(/^PMC/i, '')}` : null) ||
        (pmid ? `https://europepmc.org/article/MED/${pmid}` : null),
      volume: item.journalVolume || null,
      issue: item.issue || null,
      pages: item.pageInfo || null,
      firstPage: null,
      lastPage: null,
      keywords: collectKeywords(item),
      topics: [],
      language: null,
      workType: item.pubType || null,
      identifiers: {
        doi,
        pmid,
        pmcid,
        europepmc: item.id || null,
        issn: item.journalIssn || null
      },
      source: 'europe-pmc'
    };
  }
}

function buildEuropePmcQuery(query, yearRange, searchScope) {
  const escaped = `"${String(query || '').replace(/"/g, '\\"')}"`;
  const parts = [];
  if (searchScope === 'title-only') {
    parts.push(`TITLE:${escaped}`);
  } else if (searchScope === 'title-abstract') {
    parts.push(`(TITLE:${escaped} OR ABSTRACT:${escaped})`);
  } else {
    parts.push(escaped);
  }
  if (yearRange?.start || yearRange?.end) {
    parts.push(`PUB_YEAR:[${yearRange.start || 1800} TO ${yearRange.end || 3000}]`);
  }
  return parts.join(' AND ');
}

function parseAuthors(authorString) {
  if (!authorString) return [];
  return String(authorString)
    .replace(/\.$/, '')
    .split(/\s*,\s*/)
    .map(name => name.trim())
    .filter(Boolean);
}

function collectKeywords(item) {
  return [
    ...(Array.isArray(item.keywordList?.keyword) ? item.keywordList.keyword : []),
    ...(Array.isArray(item.meshHeadingList?.meshHeading)
      ? item.meshHeadingList.meshHeading.map(mesh => mesh.descriptorName || mesh)
      : [])
  ].filter(Boolean);
}

function collectEuropePmcPdfCandidates(item) {
  const candidates = [];
  const urls = item.fullTextUrlList?.fullTextUrl || [];
  for (const link of urls) {
    if (!link?.url) continue;
    const availability = String(link.availability || '').toLowerCase();
    const documentStyle = String(link.documentStyle || '').toLowerCase();
    const looksPdf = documentStyle.includes('pdf') || /\.pdf($|[?#])/i.test(link.url);
    if (!looksPdf) continue;
    candidates.push({
      source: 'europe-pmc',
      provider: link.site || safeHostname(link.url) || 'Europe PMC',
      url: link.url,
      access_type: availability.includes('open') ? 'pmc_oa_pdf' : 'repository',
      license: null,
      is_oa: availability.includes('open'),
      confidence: availability.includes('open') ? 0.9 : 0.65,
      reason: 'Europe PMC fullTextUrl metadata provided a PDF-like open full-text link.',
      resolver: 'europe-pmc.fullTextUrl'
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

export default EuropePmcAPI;
