/**
 * Pure / side-effect-free helpers extracted from `bin/lit-search.js`
 * so they can be unit-tested in isolation. Everything here avoids
 * touching the filesystem, process args, or `console` directly
 * (with the single exception of `expandInputPattern`, which is
 * constrained to a caller-supplied directory).
 */

/**
 * Parse the CLI argument vector into a search-options object.
 *
 * @param {string[]} args  argv.slice(2) — bare words and flags mixed
 * @param {object}   [defaults]
 * @returns {object}       parsed options; `query` may be null
 */
export function parseArgs(args, defaults = {}) {
  const cwd = defaults.cwd || process.cwd();
  const options = {
    query: null,
    limit: 3,
    yearStart: null,
    yearEnd: null,
    queryExpansion: 'none',
    searchScope: 'default-engine-search',
    outputBaseDir: cwd,
    resolvePreprint: false,
    preferPublished: false,
    withPubMed: false,
    withOpenCitations: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--limit' || arg === '-l') {
      options.limit = parseInt(args[++i], 10) || 3;
    } else if (arg === '--since' || arg === '-s' || arg === '--year-start') {
      options.yearStart = parseInt(args[++i], 10) || null;
    } else if (arg === '--until' || arg === '-u' || arg === '--year-end') {
      options.yearEnd = parseInt(args[++i], 10) || null;
    } else if (arg === '--expand') {
      options.queryExpansion = normalizeQueryExpansion(args[++i]);
    } else if (arg === '--search-scope') {
      options.searchScope = normalizeSearchScope(args[++i]);
    } else if (arg === '--output-dir') {
      options.outputBaseDir = defaults.resolvePath
        ? defaults.resolvePath(args[++i] || cwd)
        : args[++i] || cwd;
    } else if (arg === '--resolve-preprint') {
      options.resolvePreprint = true;
    } else if (arg === '--prefer-published') {
      options.preferPublished = true;
      options.resolvePreprint = true;
    } else if (arg === '--with-pubmed') {
      options.withPubMed = true;
    } else if (arg === '--with-opencitations') {
      options.withOpenCitations = true;
    } else if (arg === '--help' || arg === '-h') {
      return { ...options, _help: true };
    } else if (arg === '--version' || arg === '-v') {
      return { ...options, _version: true };
    } else if (arg === '--pdf' || arg === '--no-pdf' || arg === '--retry') {
      return { ...options, _error: 'PDF download options have been removed.' };
    } else if (arg === '--format') {
      return { ...options, _error: 'The --format option has been removed.' };
    } else if (arg.startsWith('-') && arg.length > 1) {
      return { ...options, _error: `Unknown option: ${arg}` };
    } else {
      // Bare positional: collect it. Several unquoted words get joined
      // with spaces (`lit-search machine learning -l 5`).
      options.query = options.query ? `${options.query} ${arg}` : arg;
    }
  }

  return options;
}

/**
 * Validate a `--expand` value. Throws an `Error` with a human-readable
 * message on bad input so the caller can `console.error` and exit.
 *
 * @param {string} value
 * @returns {'none' | 'pairwise' | 'full'}
 */
export function normalizeQueryExpansion(value) {
  const normalized = (value || '').toLowerCase().trim();
  const allowed = new Set(['none', 'pairwise', 'full']);
  if (!allowed.has(normalized)) {
    throw new Error(`Unsupported query expansion: ${value}`);
  }
  return normalized;
}

/**
 * Validate a `--search-scope` value. Same throwing contract as
 * `normalizeQueryExpansion`.
 *
 * @param {string} value
 * @returns {'title-only' | 'title-abstract' | 'default-engine-search'}
 */
export function normalizeSearchScope(value) {
  const normalized = (value || '').toLowerCase().trim();
  const allowed = new Set(['title-only', 'title-abstract', 'default-engine-search']);
  if (!allowed.has(normalized)) {
    throw new Error(`Unsupported search scope: ${value}`);
  }
  return normalized;
}

/**
 * Resolve a glob-style input pattern into a list of file/dir paths.
 * The caller supplies the directory and a `readdir`/`existsSync`
 * pair so this function stays pure-ish.
 *
 * @param {string} pattern
 * @param {object} fs   { readdir: (dir) => string[], exists: (path) => bool }
 * @returns {string[]}
 */
export function expandInputPattern(pattern, fs) {
  if (!pattern.includes('*')) return [pattern];
  const dirSep = fs.sep || '/';
  const parts = pattern.split(/[\\/]/);
  const baseName = parts.pop();
  const dir = parts.length ? parts.join(dirSep) : '.';
  const regex = new RegExp(`^${baseName.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);
  return fs
    .readdir(dir)
    .filter((name) => regex.test(name))
    .map((name) => (dir === '.' ? name : `${dir}${dirSep}${name}`))
    .filter((path) => fs.exists(path));
}

/**
 * Get the value following a `--name` flag, or `null` if the flag is
 * missing or its value starts with `-` (treat it as a separate flag).
 *
 * @param {string[]} args
 * @param {string}   name
 * @returns {string | null}
 */
export function getOptionValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  return value && !value.startsWith('-') ? value : null;
}

/**
 * Numeric variant of `getOptionValue` with a fallback.
 *
 * @param {string[]} args
 * @param {string}   name
 * @param {number}   fallback
 * @returns {number}
 */
export function getNumberOptionValue(args, name, fallback) {
  const value = getOptionValue(args, name);
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Interpret an `inquirer` answer for an init-time field.
 *
 * Rules:
 *   - "-"     → null (explicit clear)
 *   - ""      → keep `currentValue`
 *   - "   "   → keep `currentValue` (whitespace-only is also a no-op)
 *   - "foo"   → "foo"
 *
 * @param {string | undefined} input
 * @param {string | null}      currentValue
 * @returns {string | null}
 */
export function resolveInitValue(input, currentValue) {
  if (input === '-') return null;
  if (input === '' || input === undefined) return currentValue || null;
  const trimmed = String(input).trim();
  return trimmed || currentValue || null;
}

/**
 * Merge the persisted engine preferences with the per-run CLI overrides.
 *
 * @param {object} configEngines   output of `config.get('engines')`
 * @param {object} options         parsed CLI options
 * @returns {object}               runtime engines object
 */
export function buildRuntimeEngines(configEngines = {}, options = {}) {
  return {
    ...configEngines,
    ...(options.withPubMed ? { pubmed: true } : {}),
    ...(options.withOpenCitations ? { openCitations: true } : {}),
  };
}
