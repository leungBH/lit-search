import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { basename, join } from 'node:path';

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_REDIRECTS = 5;
const BROWSER_CHALLENGE_PATTERNS = [
  /captcha/i,
  /cloudflare/i,
  /cf-chl/i,
  /human verification/i,
  /verify you are human/i,
  /checking your browser/i,
  /access denied/i,
  /robot check/i,
  /bot detection/i
];

export async function downloadPaperPdfs(papers, outputDir, options = {}) {
  const logger = options.logger || console;
  const pdfDir = join(outputDir, 'pdfs');
  const results = [];

  await mkdir(pdfDir, { recursive: true });

  for (const paper of papers) {
    if (!paper.pdf_url) {
      const failure = buildPdfFailure({
        status: 'skipped',
        code: 'no_pdf_url',
        message: 'No PDF URL was provided by this source.',
        action: 'Use the DOI/URL to locate a full-text copy through an institutional login, repository, or another source.'
      });
      paper.pdf_download = failure;
      results.push({ paper, ...failure });
      continue;
    }

    const fileName = buildPdfFileName(paper);
    const filePath = join(pdfDir, fileName);

    try {
      const result = await downloadPdf(paper.pdf_url, filePath, options);
      const success = {
        status: 'success',
        code: 'downloaded',
        message: 'PDF downloaded successfully.',
        filePath,
        url: paper.pdf_url,
        ...result
      };
      paper.pdf_download = success;
      results.push({ paper, ...success });
      logger.info?.(`   PDF ${paper.seq_id}: saved ${fileName}`);
    } catch (error) {
      const failure = normalizeDownloadError(error, paper.pdf_url);
      paper.pdf_download = failure;
      results.push({ paper, status: 'failed', ...failure });
      logger.info?.(`   PDF ${paper.seq_id}: skipped (${failure.code}: ${failure.message} Action: ${failure.action})`);
    }
  }

  return {
    pdfDir,
    total: papers.length,
    downloaded: results.filter(item => item.status === 'success').length,
    skipped: results.filter(item => item.status === 'skipped').length,
    failed: results.filter(item => item.status === 'failed').length,
    results
  };
}

async function downloadPdf(url, filePath, options = {}) {
  const response = await fetchBinary(url, {
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    maxRedirects: options.maxRedirects ?? MAX_REDIRECTS
  });

  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  const isPdf = contentType.includes('application/pdf') || response.head.equals(Buffer.from('%PDF-'));

  if (!isPdf) {
    throw buildDownloadError('not_direct_pdf', 'The URL did not return a PDF file.', {
      contentType: contentType || 'unknown',
      finalUrl: response.finalUrl,
      bodySample: response.body.subarray(0, 2048).toString('utf8')
    });
  }

  await writeBuffer(filePath, response.body);
  return { bytes: response.body.length, contentType };
}

function fetchBinary(url, options, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === 'http:' ? http : https;

    const request = transport.request(parsedUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'lit-search/1.0 (Academic Research Tool)',
        'Accept': 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.5'
      }
    }, response => {
      const statusCode = response.statusCode || 0;

      if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
        response.resume();
        if (redirectCount >= options.maxRedirects) {
          reject(buildDownloadError('too_many_redirects', 'The PDF URL redirected too many times.', {
            statusCode,
            url: parsedUrl.toString()
          }));
          return;
        }

        const nextUrl = new URL(response.headers.location, parsedUrl).toString();
        fetchBinary(nextUrl, options, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks);
          reject(buildDownloadError(classifyHttpStatus(statusCode, response.headers, body), `HTTP ${statusCode}`, {
            statusCode,
            headers: response.headers,
            finalUrl: parsedUrl.toString(),
            bodySample: body.subarray(0, 2048).toString('utf8')
          }));
        });
        return;
      }

      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({
          headers: response.headers,
          body,
          head: body.subarray(0, 5),
          finalUrl: parsedUrl.toString()
        });
      });
    });

    request.on('error', error => {
      reject(buildDownloadError('network_error', error.message, { cause: error }));
    });
    request.setTimeout(options.timeoutMs, () => {
      request.destroy(buildDownloadError(
        'timeout',
        `Download timed out after ${Math.ceil(options.timeoutMs / 1000)}s.`,
        { timeoutMs: options.timeoutMs }
      ));
    });
    request.end();
  });
}

function classifyHttpStatus(statusCode, headers = {}, body = Buffer.alloc(0)) {
  const text = `${headers.server || ''}\n${headers['www-authenticate'] || ''}\n${body.toString('utf8', 0, 4096)}`;

  if (statusCode === 401) return 'authentication_required';
  if (statusCode === 402) return 'payment_or_subscription_required';
  if (statusCode === 403) {
    return hasBrowserChallenge(text) ? 'human_verification_required' : 'access_denied_or_bot_check';
  }
  if (statusCode === 404) return 'pdf_not_found';
  if (statusCode === 429) return 'rate_limited';
  if (statusCode >= 500) return 'remote_server_error';
  return 'http_error';
}

function hasBrowserChallenge(text) {
  return BROWSER_CHALLENGE_PATTERNS.some(pattern => pattern.test(text));
}

function normalizeDownloadError(error, url) {
  const code = error.code || 'download_failed';
  const message = buildHumanMessage(code, error.message, error.details);
  const action = buildSuggestedAction(code, url, error.details);

  return buildPdfFailure({
    code,
    message,
    action,
    url,
    details: sanitizeDetails(error.details)
  });
}

function buildPdfFailure({ status = 'failed', code, message, action, url = null, details = null }) {
  return {
    status,
    code,
    message,
    action,
    url,
    details
  };
}

function buildDownloadError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function buildHumanMessage(code, fallbackMessage, details = {}) {
  const messages = {
    access_denied_or_bot_check: 'The remote site refused automated PDF download. This is often caused by publisher access controls, anti-bot rules, or hotlink protection.',
    human_verification_required: 'The PDF URL appears to require browser-based human verification before access.',
    authentication_required: 'The PDF URL requires login or institutional authentication.',
    payment_or_subscription_required: 'The PDF appears to require payment or a subscription.',
    not_direct_pdf: `The URL returned a non-PDF response (${details?.contentType || 'unknown content-type'}). It may be a landing page rather than a direct PDF.`,
    pdf_not_found: 'The PDF URL returned 404 Not Found.',
    rate_limited: 'The remote site rate-limited the download request.',
    remote_server_error: 'The remote PDF host returned a server error.',
    timeout: fallbackMessage,
    network_error: `Network error while downloading PDF: ${fallbackMessage}`,
    too_many_redirects: 'The PDF URL redirected too many times.'
  };

  return messages[code] || fallbackMessage || 'PDF download failed.';
}

function buildSuggestedAction(code, url, details = {}) {
  const actions = {
    access_denied_or_bot_check: 'Try another open-access location such as arXiv, CORE, PubMed Central, an institutional repository, or use the DOI/landing page manually in a browser.',
    human_verification_required: 'Do not bypass the challenge. Open the landing page in a browser, complete verification manually if you have legitimate access, then provide an accessible PDF URL or use another OA source.',
    authentication_required: 'Use a browser session with legitimate institutional access, or search for an open repository copy by DOI/title.',
    payment_or_subscription_required: 'Search for an open-access manuscript version by DOI/title, or use institutional/library access.',
    not_direct_pdf: 'Treat this as a landing page. Follow the page manually or search the DOI/title in arXiv, CORE, PubMed Central, OpenAlex locations, or the publisher site.',
    pdf_not_found: 'Try the landing page URL or search by DOI/title in another source.',
    rate_limited: 'Retry later with a lower request rate.',
    remote_server_error: 'Retry later or try another full-text source.',
    timeout: 'Retry later or use another PDF mirror/source.',
    network_error: 'Check network/proxy settings, then retry or use another source.',
    too_many_redirects: 'Open the landing page manually or try another source.'
  };

  if (details?.finalUrl && details.finalUrl !== url) {
    return `${actions[code] || actions.not_direct_pdf} Final URL: ${details.finalUrl}`;
  }

  return actions[code] || 'Try another source, DOI lookup, or manual browser access.';
}

function sanitizeDetails(details = null) {
  if (!details) return null;
  return {
    statusCode: details.statusCode || null,
    contentType: details.contentType || details.headers?.['content-type'] || null,
    finalUrl: details.finalUrl || null
  };
}

function writeBuffer(filePath, buffer) {
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(filePath);
    stream.on('error', reject);
    stream.on('finish', resolve);
    stream.end(buffer);
  });
}

function buildPdfFileName(paper) {
  const citationKey = sanitizeFilePart(paper.citation_key || `paper_${paper.seq_id || ''}`);
  const source = sanitizeFilePart(paper.source || 'unknown');
  const title = sanitizeFilePart(paper.title || basename(String(paper.pdf_url || 'paper')));
  const shortTitle = title.slice(0, 80).replace(/_+$/g, '');

  return `${String(paper.seq_id || '').padStart(3, '0')}_${citationKey}_${source}_${shortTitle}.pdf`;
}

function sanitizeFilePart(value) {
  return String(value || 'untitled')
    .normalize('NFKD')
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'untitled';
}
