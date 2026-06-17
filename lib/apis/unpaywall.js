import { createRequestSignal, isAbortError } from './request-utils.js';

const BASE_URL = 'https://api.unpaywall.org/v2';

export class UnpaywallAPI {
  constructor(email = null, logger = console) {
    this.email = email || null;
    this.logger = logger;
    this.queryTimeoutMs = 12000;
  }

  async fetchByDoi(doi, signal = null) {
    if (!doi || !this.email) return null;
    const params = new URLSearchParams({ email: this.email });
    const request = createRequestSignal(signal, this.queryTimeoutMs);
    try {
      const response = await fetch(`${BASE_URL}/${encodeURIComponent(normalizeDoi(doi))}?${params}`, {
        signal: request.signal
      });
      if (!response.ok) return null;
      return normalizeUnpaywall(await response.json());
    } catch (error) {
      if (isAbortError(error) || request.signal.aborted) return null;
      return null;
    } finally {
      request.cleanup();
    }
  }
}

function normalizeUnpaywall(data) {
  const locations = [data.best_oa_location, ...(data.oa_locations || [])].filter(Boolean);
  return {
    doi: data.doi || null,
    is_oa: Boolean(data.is_oa),
    oa_status: data.oa_status || null,
    genre: data.genre || null,
    title: data.title || null,
    year: data.year || null,
    journal: data.journal_name || null,
    publisher: data.publisher || null,
    license: data.best_oa_location?.license || null,
    pdfCandidates: locations.flatMap(location => toPdfCandidate(location, data)).filter(Boolean)
  };
}

function toPdfCandidate(location, data) {
  const url = location.url_for_pdf || location.url || null;
  if (!url) return [];
  return [{
    source: 'unpaywall',
    provider: location.host_type || safeHostname(url) || 'unpaywall',
    url,
    access_type: inferAccessType(location),
    license: location.license || null,
    is_oa: true,
    confidence: location.url_for_pdf ? 0.88 : 0.62,
    reason: `Unpaywall ${location.version || 'open'} location for DOI ${data.doi || ''}.`.trim(),
    resolver: 'unpaywall.oa_location'
  }];
}

function inferAccessType(location) {
  const version = String(location.version || '').toLowerCase();
  const hostType = String(location.host_type || '').toLowerCase();
  if (version.includes('published')) return 'publisher_oa_pdf';
  if (version.includes('accepted')) return 'accepted_manuscript';
  if (hostType.includes('repository')) return 'institutional_repository';
  return 'oa_location';
}

function normalizeDoi(value) {
  return String(value)
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .replace(/[).,;]+$/g, '')
    .toLowerCase();
}

function safeHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export default UnpaywallAPI;
