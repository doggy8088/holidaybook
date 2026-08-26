'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseChecksums,
  requireChecksum,
  assertMatches,
  ChecksumFormatError,
  ChecksumAmbiguityError,
  ChecksumNotFoundError,
  ChecksumMismatchError,
} = require('../lib/checksums');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

test('checksums: parses standard sha256sum-format lines exactly', () => {
  const text = `${HASH_A}  holidaytw_darwin_amd64.tar.gz\n${HASH_B}  holidaytw_linux_amd64.tar.gz\n`;
  const map = parseChecksums(text);
  assert.equal(map.size, 2);
  assert.equal(map.get('holidaytw_darwin_amd64.tar.gz'), HASH_A);
  assert.equal(map.get('holidaytw_linux_amd64.tar.gz'), HASH_B);
});

test('checksums: tolerates the binary-mode "*" marker and CRLF line endings', () => {
  const text = `${HASH_A} *holidaytw_darwin_amd64.tar.gz\r\n`;
  const map = parseChecksums(text);
  assert.equal(map.get('holidaytw_darwin_amd64.tar.gz'), HASH_A);
});

test('checksums: is case-insensitive on hex digits but normalizes to lowercase', () => {
  const text = `${HASH_A.toUpperCase()}  file.tar.gz\n`;
  const map = parseChecksums(text);
  assert.equal(map.get('file.tar.gz'), HASH_A);
});

test('checksums: ignores blank lines', () => {
  const text = `\n${HASH_A}  file.tar.gz\n\n\n`;
  const map = parseChecksums(text);
  assert.equal(map.size, 1);
});

test('checksums: rejects malformed lines', () => {
  assert.throws(() => parseChecksums('not-a-valid-line\n'), ChecksumFormatError);
  assert.throws(() => parseChecksums(`${'a'.repeat(63)}  short-hash.tar.gz\n`), ChecksumFormatError);
});

test('checksums: exact duplicate lines for the same file are tolerated', () => {
  const text = `${HASH_A}  file.tar.gz\n${HASH_A}  file.tar.gz\n`;
  const map = parseChecksums(text);
  assert.equal(map.get('file.tar.gz'), HASH_A);
});

test('checksums: conflicting duplicate entries for the same filename are rejected as ambiguous', () => {
  const text = `${HASH_A}  file.tar.gz\n${HASH_B}  file.tar.gz\n`;
  assert.throws(() => parseChecksums(text), ChecksumAmbiguityError);
});

test('checksums: requireChecksum throws when the filename has no entry', () => {
  const map = parseChecksums(`${HASH_A}  other-file.tar.gz\n`);
  assert.throws(() => requireChecksum(map, 'missing.tar.gz'), ChecksumNotFoundError);
});

test('checksums: requireChecksum returns the exact matching entry', () => {
  const map = parseChecksums(`${HASH_A}  target.tar.gz\n${HASH_B}  other.tar.gz\n`);
  assert.equal(requireChecksum(map, 'target.tar.gz'), HASH_A);
});

test('checksums: assertMatches is case-insensitive and passes on equal hashes', () => {
  assert.doesNotThrow(() => assertMatches(HASH_A, HASH_A.toUpperCase(), 'file.tar.gz'));
});

test('checksums: assertMatches throws ChecksumMismatchError on mismatch', () => {
  assert.throws(() => assertMatches(HASH_A, HASH_B, 'file.tar.gz'), ChecksumMismatchError);
});
