'use strict';

class ChecksumFormatError extends Error {}
class ChecksumAmbiguityError extends Error {}
class ChecksumNotFoundError extends Error {}
class ChecksumMismatchError extends Error {}

// Standard `sha256sum` output format: 64 hex chars, whitespace, an optional
// text/binary marker (' ' or '*'), then the filename.
const LINE_RE = /^([0-9a-fA-F]{64})[ \t]+[* ]?(.+)$/;

/**
 * Parse a checksums.txt file into a Map<filename, lowercase-hex-sha256>.
 * Throws on malformed lines or on ambiguous (conflicting) duplicate entries
 * for the same filename.
 * @param {string} text
 * @returns {Map<string,string>}
 */
function parseChecksums(text) {
  const map = new Map();
  const lines = String(text).split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const match = LINE_RE.exec(line);
    if (!match) {
      throw new ChecksumFormatError(`Malformed checksums.txt line: ${JSON.stringify(rawLine)}`);
    }
    const hash = match[1].toLowerCase();
    const name = match[2].trim();
    if (map.has(name)) {
      const existing = map.get(name);
      if (existing !== hash) {
        throw new ChecksumAmbiguityError(
          `Ambiguous checksums.txt entries for "${name}": ${existing} vs ${hash}`
        );
      }
      // exact duplicate line, harmless, ignore
    } else {
      map.set(name, hash);
    }
  }
  return map;
}

/**
 * @param {Map<string,string>} map
 * @param {string} filename
 * @returns {string} lowercase hex sha256
 */
function requireChecksum(map, filename) {
  const hash = map.get(filename);
  if (!hash) {
    throw new ChecksumNotFoundError(`No checksums.txt entry found for "${filename}"`);
  }
  return hash;
}

/**
 * @param {string} actualHex
 * @param {string} expectedHex
 * @param {string} label used in the error message
 */
function assertMatches(actualHex, expectedHex, label) {
  if (String(actualHex).toLowerCase() !== String(expectedHex).toLowerCase()) {
    throw new ChecksumMismatchError(
      `SHA-256 checksum mismatch for ${label}: expected ${expectedHex}, got ${actualHex}`
    );
  }
}

module.exports = {
  parseChecksums,
  requireChecksum,
  assertMatches,
  ChecksumFormatError,
  ChecksumAmbiguityError,
  ChecksumNotFoundError,
  ChecksumMismatchError,
};
