'use strict';

const fs = require('fs');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

class DownloadError extends Error {}

/**
 * Download a URL to a file on disk, streaming to bound memory usage and
 * enforcing a maximum byte count against both the advertised
 * Content-Length and the actual bytes received.
 *
 * @param {string} url
 * @param {string} destPath
 * @param {{maxBytes?: number, timeoutMs?: number, fetchImpl?: typeof fetch}} [opts]
 * @returns {Promise<number>} total bytes written
 */
async function downloadToFile(url, destPath, opts = {}) {
  const maxBytes = opts.maxBytes ?? Infinity;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const doFetch = opts.fetchImpl ?? fetch;

  let response;
  try {
    response = await doFetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new DownloadError(`Network error while downloading ${url}: ${err.message}`);
  }

  if (!response.ok) {
    throw new DownloadError(`HTTP ${response.status} ${response.statusText} while downloading ${url}`);
  }
  if (!response.body) {
    throw new DownloadError(`Empty response body while downloading ${url}`);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new DownloadError(
        `Refusing to download ${url}: declared size ${declared} bytes exceeds the maximum allowed ${maxBytes} bytes`
      );
    }
  }

  let total = 0;
  const nodeReadable = Readable.fromWeb(response.body);
  const out = fs.createWriteStream(destPath, { flags: 'wx', mode: 0o600 });

  const guard = async function* () {
    for await (const chunk of nodeReadable) {
      total += chunk.length;
      if (total > maxBytes) {
        throw new DownloadError(
          `Download of ${url} exceeded the maximum allowed size of ${maxBytes} bytes`
        );
      }
      yield chunk;
    }
  };

  try {
    await pipeline(guard(), out);
  } catch (err) {
    await fs.promises.rm(destPath, { force: true });
    if (err instanceof DownloadError) throw err;
    throw new DownloadError(`Failed while downloading ${url}: ${err.message}`);
  }

  return total;
}

/**
 * Download a URL and return its body as text, bounded by maxBytes.
 * @param {string} url
 * @param {{maxBytes?: number, timeoutMs?: number, fetchImpl?: typeof fetch}} [opts]
 * @returns {Promise<string>}
 */
async function downloadText(url, opts = {}) {
  const maxBytes = opts.maxBytes ?? Infinity;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const doFetch = opts.fetchImpl ?? fetch;

  let response;
  try {
    response = await doFetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new DownloadError(`Network error while downloading ${url}: ${err.message}`);
  }

  if (!response.ok) {
    throw new DownloadError(`HTTP ${response.status} ${response.statusText} while downloading ${url}`);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new DownloadError(
        `Refusing to download ${url}: declared size ${declared} bytes exceeds the maximum allowed ${maxBytes} bytes`
      );
    }
  }

  let buf;
  try {
    buf = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    throw new DownloadError(`Failed while downloading ${url}: ${err.message}`);
  }
  if (buf.length > maxBytes) {
    throw new DownloadError(
      `Download of ${url} exceeded the maximum allowed size of ${maxBytes} bytes`
    );
  }
  return buf.toString('utf8');
}

module.exports = { downloadToFile, downloadText, DownloadError };
