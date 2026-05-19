const ACCESS_PRIORITY = {
  arxiv: 100,
  pmc: 92,
  core: 86,
  institutional_repository: 80,
  repository: 74,
  openalex_content_api: 68,
  publisher_oa_pdf: 60,
  crossref_pdf_link: 52,
  doi_landing_page: 22,
  browser_fallback: 10,
  unknown: 1
};

const DOWNLOADABLE_ACCESS_TYPES = new Set([
  'arxiv',
  'pmc',
  'core',
  'institutional_repository',
  'repository',
  'openalex_content_api',
  'publisher_oa_pdf',
  'crossref_pdf_link',
  'unknown'
]);

export function buildPdfCandidate(input = {}) {
  if (!input.url) return null;
  const url = normalizeUrl(input.url);
  if (!url) return null;

  const source = input.source || 'unknown';
  const provider = input.provider || inferProvider(url) || source;
  const accessType = input.access_type || inferAccessType(url, input);
  const isOa = input.is_oa === undefined ? inferOpenAccess(accessType) : Boolean(input.is_oa);
  const baseScore = ACCESS_PRIORITY[accessType] ?? ACCESS_PRIORITY.unknown;
  const confidence = normalizeConfidence(input.confidence ?? buildConfidence(baseScore, input, url));

  return {
    url,
    source,
    provider,
    access_type: accessType,
    license: input.license || null,
    is_oa: isOa,
    confidence,
    reason: input.reason || buildReason(accessType, provider),
    rank: 0
  };
}

export function normalizePdfCandidates(candidates = []) {
  const byUrl = new Map();

  for (const rawCandidate of candidates.flat().filter(Boolean)) {
    const candidate = buildPdfCandidate(rawCandidate);
    if (!candidate) continue;
    const key = candidate.url.toLowerCase();
    const existing = byUrl.get(key);
    if (!existing || scoreCandidate(candidate) > scoreCandidate(existing)) {
      byUrl.set(key, candidate);
    }
  }

  return [...byUrl.values()]
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1
    }));
}

export function mergePdfCandidates(...candidateLists) {
  return normalizePdfCandidates(candidateLists.flat());
}

export function selectBestPdfCandidate(candidates = []) {
  return normalizePdfCandidates(candidates)[0] || null;
}

export function getDownloadablePdfCandidates(paper) {
  return normalizePdfCandidates(paper.pdf_candidates || [])
    .filter(candidate => DOWNLOADABLE_ACCESS_TYPES.has(candidate.access_type));
}

export function getBestPdfCandidateUrl(paper) {
  return selectBestPdfCandidate(paper.pdf_candidates || [])?.url || null;
}

function scoreCandidate(candidate) {
  const priority = ACCESS_PRIORITY[candidate.access_type] ?? ACCESS_PRIORITY.unknown;
  return priority + candidate.confidence;
}

function normalizeUrl(value) {
  try {
    return new URL(String(value).trim()).toString();
  } catch {
    return null;
  }
}

function normalizeConfidence(value) {
  const number = Number(value);
  const normalized = !Number.isFinite(number)
    ? 0.5
    : number > 1
      ? Math.max(0, Math.min(1, number / 100))
      : Math.max(0, Math.min(1, number));
  return Math.round(normalized * 100) / 100;
}

function buildConfidence(baseScore, input, url) {
  let confidence = baseScore / 100;
  if (input.is_oa === true) confidence += 0.04;
  if (String(url).toLowerCase().endsWith('.pdf')) confidence += 0.03;
  if (input.license) confidence += 0.02;
  return confidence;
}

function inferProvider(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function inferAccessType(url, input = {}) {
  const host = inferProvider(url) || '';
  const providerText = `${input.provider || ''} ${input.sourceName || ''}`.toLowerCase();
  const sourceType = String(input.sourceType || '').toLowerCase();

  if (/arxiv\.org$/.test(host)) return 'arxiv';
  if (/(ncbi\.nlm\.nih\.gov|pmc|pubmedcentral)/i.test(host)) return 'pmc';
  if (/core\.ac\.uk$/i.test(host) || input.source === 'core') return 'core';
  if (sourceType === 'repository') {
    return /(university|institution|repository|archive|repo|scholarworks|eprints|dspace|ir\.)/i.test(`${host} ${providerText}`)
      ? 'institutional_repository'
      : 'repository';
  }
  if (input.resolver === 'openalex.open_access.oa_url') return 'openalex_content_api';
  if (input.resolver === 'crossref.link') return 'crossref_pdf_link';
  if (input.resolver === 'doi.landing') return 'doi_landing_page';
  if (input.resolver === 'browser.fallback') return 'browser_fallback';
  if (input.is_oa === true) return 'publisher_oa_pdf';
  return 'unknown';
}

function inferOpenAccess(accessType) {
  return !['doi_landing_page', 'browser_fallback', 'unknown'].includes(accessType);
}

function buildReason(accessType, provider) {
  const reasons = {
    arxiv: 'arXiv PDF is usually a direct open-access full-text file.',
    pmc: 'PubMed Central full text is usually open access.',
    core: 'CORE download URL points to an open-access copy when available.',
    institutional_repository: 'Institutional repository candidates are preferred over publisher landing pages.',
    repository: 'Repository candidates are usually more automation-friendly than publisher pages.',
    openalex_content_api: 'OpenAlex open-access location was provided for this work.',
    publisher_oa_pdf: 'Publisher or platform marks this PDF as open access.',
    crossref_pdf_link: 'CrossRef metadata advertises this link as a PDF.',
    doi_landing_page: 'DOI landing page is included for manual or browser-assisted fallback.',
    browser_fallback: 'Landing page fallback for manual browser access.',
    unknown: 'Candidate URL was provided by a literature source but access type is uncertain.'
  };
  return `${reasons[accessType] || reasons.unknown} Provider: ${provider || 'unknown'}.`;
}
