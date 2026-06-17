import Conf from 'conf';

const APP_CONFIG_DEFAULTS = {
  apiKeys: { s2: null, openalex: null, crossrefMailto: null, core: null, ncbi: null, unpaywallEmail: null },
  engines: {
    semanticScholar: true,
    openalex: true,
    arxiv: true,
    crossref: true,
    core: true,
    europePmc: true,
    dblp: true,
    doaj: true,
    pubmed: false,
    unpaywall: true,
    openCitations: false
  },
  search: { limit: 10 }
};

export function createAppConfig() {
  return new Conf({
    projectName: 'lit-search',
    defaults: APP_CONFIG_DEFAULTS
  });
}

export function getStoredApiKeys(config) {
  return { ...(config.get('apiKeys') || {}) };
}

export function getEnvApiKeys(env = process.env) {
  return compactApiKeys({
    s2: env.LIT_SEARCH_S2_API_KEY || env.SEMANTIC_SCHOLAR_API_KEY || null,
    openalex: env.LIT_SEARCH_OPENALEX_API_KEY || env.OPENALEX_API_KEY || null,
    crossrefMailto: env.LIT_SEARCH_CROSSREF_MAILTO || env.CROSSREF_MAILTO || null,
    core: env.LIT_SEARCH_CORE_API_KEY || env.CORE_API_KEY || null,
    ncbi: env.LIT_SEARCH_NCBI_API_KEY || env.NCBI_API_KEY || null,
    unpaywallEmail: env.LIT_SEARCH_UNPAYWALL_EMAIL || env.UNPAYWALL_EMAIL || null
  });
}

export function getResolvedApiKeys(config, env = process.env) {
  return {
    ...getStoredApiKeys(config),
    ...getEnvApiKeys(env)
  };
}

export function saveApiKeys(config, apiKeys) {
  config.set('apiKeys', {
    s2: apiKeys.s2 || null,
    openalex: apiKeys.openalex || null,
    crossrefMailto: apiKeys.crossrefMailto || null,
    core: apiKeys.core || null,
    ncbi: apiKeys.ncbi || null,
    unpaywallEmail: apiKeys.unpaywallEmail || null
  });
}

export function summarizeApiKeySources(config, env = process.env) {
  const stored = getStoredApiKeys(config);
  const fromEnv = getEnvApiKeys(env);

  return {
    storedPath: config.path,
    values: summarizeLoadedKeys({ ...stored, ...fromEnv }),
    stored: summarizeLoadedKeys(stored),
    env: summarizeLoadedKeys(fromEnv)
  };
}

function compactApiKeys(apiKeys) {
  return Object.fromEntries(
    Object.entries(apiKeys).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
  );
}

function summarizeLoadedKeys(apiKeys) {
  return {
    semanticScholar: Boolean(apiKeys.s2),
    openalex: Boolean(apiKeys.openalex),
    crossrefMailto: Boolean(apiKeys.crossrefMailto),
    core: Boolean(apiKeys.core),
    ncbi: Boolean(apiKeys.ncbi),
    unpaywallEmail: Boolean(apiKeys.unpaywallEmail)
  };
}
