/**
 * lit-search - Single-paper lookup orchestrator
 *
 * Tries multiple sources in parallel and merges the most complete result.
 * Used by the `get_paper` MCP tool and any programmatic caller.
 */

import { OpenAlexAPI } from './apis/openalex.js';
import { SemanticScholarAPI } from './apis/semantic-scholar.js';
import { CrossrefAPI } from './apis/crossref.js';
import { ArxivAPI } from './apis/arxiv.js';
import { LitSearchError, wrapError } from './errors.js';
import { silentLogger } from './logger.js';

const DOI_REGEX = /\b10\.\d{4,9}\/[^\s"<>]+\b/i;

const DEFAULT_SOURCES = {
  doi: ['openalex', 'semantic-scholar', 'crossref'],
  title: ['openalex', 'semantic-scholar', 'arxiv'],
};

const COMPLETENESS_FIELDS = [
  'abstract',
  'authors',
  'venue',
  'year',
  'doi',
  'citationCount',
  'volume',
  'issue',
  'pages',
];

export function detectInputType(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  return DOI_REGEX.test(input) ? 'doi' : 'title';
}

export function normalizeDoi(raw) {
  if (!raw) return '';
  return String(raw)
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[.,;)\]}>]+$/, '')
    .toLowerCase();
}

export function normalizeTitle(raw) {
  if (!raw) return '';
  return String(raw).replace(/\s+/g, ' ').trim();
}

export async function lookupPaper({
  doi,
  title,
  sources,
  apiKeys = {},
  logger = silentLogger,
  signal,
} = {}) {
  const hasDoi = typeof doi === 'string' && doi.trim().length > 0;
  const hasTitle = typeof title === 'string' && title.trim().length > 0;

  if (hasDoi && hasTitle) {
    throw new LitSearchError('INVALID_INPUT', 'Provide exactly one of doi or title, not both');
  }
  if (!hasDoi && !hasTitle) {
    throw new LitSearchError('MISSING_REQUIRED', 'Either doi or title is required');
  }

  const inputType = hasDoi ? 'doi' : 'title';
  const target = inputType === 'doi' ? normalizeDoi(doi) : normalizeTitle(title);
  const sourceList =
    Array.isArray(sources) && sources.length > 0 ? sources : DEFAULT_SOURCES[inputType];

  if (inputType === 'doi' && sourceList.includes('arxiv')) {
    throw new LitSearchError(
      'INVALID_INPUT',
      'arXiv cannot resolve a DOI. Use sources without arxiv for DOI lookups.'
    );
  }
  if (inputType === 'title' && sourceList.includes('crossref')) {
    // CrossRef is allowed for title; just informational
  }

  const tasks = sourceList.map((source) =>
    safeLookup(source, target, inputType, apiKeys, logger, signal)
  );
  const settled = await Promise.allSettled(tasks);

  const hits = [];
  const failures = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === 'fulfilled' && r.value) {
      hits.push({ source: sourceList[i], paper: r.value });
    } else if (r.status === 'rejected') {
      const e = wrapError(r.reason);
      // Only record structured failures; skip 404 (expected miss)
      if (e.code !== 'NOT_FOUND') {
        failures.push({ source: sourceList[i], code: e.code, message: e.message });
      }
    }
  }

  if (hits.length === 0) {
    throw new LitSearchError(
      'NOT_FOUND',
      `Paper not found in any source for ${inputType}: ${target}`,
      {
        inputType,
        target,
        sources: sourceList,
        failures,
      }
    );
  }

  const merged = mergeHits(hits, inputType, target);
  return {
    paper: merged,
    sources: hits.map((h) => h.source),
    failures,
  };
}

async function safeLookup(source, target, inputType, apiKeys, logger, signal) {
  const client = makeClient(source, apiKeys, logger);
  const method = inputType === 'doi' ? 'lookupByDoi' : 'lookupByTitle';
  return await client[method](target, { signal });
}

function makeClient(source, apiKeys, logger) {
  switch (source) {
    case 'openalex':
      return new OpenAlexAPI(apiKeys.openalex || null, logger);
    case 'semantic-scholar':
      return new SemanticScholarAPI(apiKeys.s2 || apiKeys.semanticScholar || null, logger);
    case 'crossref':
      return new CrossrefAPI(apiKeys.crossrefMailto || apiKeys.crossref || null, logger);
    case 'arxiv':
      return new ArxivAPI();
    default:
      throw new LitSearchError('INVALID_INPUT', `Unknown source: ${source}`);
  }
}

function mergeHits(hits, inputType, target) {
  const ranked = [...hits].sort((a, b) => paperCompleteness(b.paper) - paperCompleteness(a.paper));
  const primary = ranked[0].paper;
  const merged = { ...primary };
  for (const h of hits) {
    for (const [k, v] of Object.entries(h.paper)) {
      if (k === 'identifiers' || k === '_sources') continue;
      const existing = merged[k];
      if (isEmpty(existing) && !isEmpty(v)) merged[k] = v;
    }
  }
  merged.identifiers = mergeIdentifiers(hits.map((h) => () => h.paper.identifiers || {}));
  merged._lookup = {
    inputType,
    target,
    sources: hits.map((h) => h.source),
    failures: [],
  };
  return merged;
}

function mergeIdentifiers(getters) {
  const merged = {};
  for (const get of getters) {
    const id = get();
    for (const [k, v] of Object.entries(id)) {
      if (v && !merged[k]) merged[k] = v;
    }
  }
  return merged;
}

function paperCompleteness(p) {
  if (!p) return 0;
  let score = 0;
  for (const f of COMPLETENESS_FIELDS) {
    const v = p[f];
    if (Array.isArray(v) ? v.length > 0 : v) score += 1;
  }
  return score;
}

function isEmpty(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}
