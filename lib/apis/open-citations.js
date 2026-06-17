import { createRequestSignal, isAbortError } from './request-utils.js';

const BASE_URL = 'https://opencitations.net/index/api/v2';

export class OpenCitationsAPI {
  constructor(logger = console) {
    this.logger = logger;
    this.queryTimeoutMs = 12000;
  }

  async fetchCitationRelations(doi, signal = null) {
    if (!doi) return null;
    const clean = normalizeDoi(doi);
    const [references, citations] = await Promise.all([
      this._fetchEndpoint(`references/doi:${encodeURIComponent(clean)}`, signal),
      this._fetchEndpoint(`citations/doi:${encodeURIComponent(clean)}`, signal)
    ]);
    return {
      doi: clean,
      references: normalizeRelations(references),
      citations: normalizeRelations(citations)
    };
  }

  async _fetchEndpoint(path, signal) {
    const request = createRequestSignal(signal, this.queryTimeoutMs);
    try {
      const response = await fetch(`${BASE_URL}/${path}`, { signal: request.signal });
      if (!response.ok) return [];
      return await response.json();
    } catch (error) {
      if (isAbortError(error) || request.signal.aborted) return [];
      return [];
    } finally {
      request.cleanup();
    }
  }
}

function normalizeRelations(items) {
  return (Array.isArray(items) ? items : []).map(item => ({
    citing: item.citing || null,
    cited: item.cited || null,
    creation: item.creation || null,
    timespan: item.timespan || null,
    journal_sc: item.journal_sc || null
  }));
}

function normalizeDoi(value) {
  return String(value)
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .replace(/[).,;]+$/g, '')
    .toLowerCase();
}

export default OpenCitationsAPI;
