'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');

const { extractFileFromTarGz, TarError } = require('../lib/tarExtract');
const { buildTarGz, buildTarGzWithBadChecksum } = require('./helpers/tarBuilder');

test('tarExtract: extracts the target regular file alongside other entries (matches GoReleaser layout)', () => {
  const gz = buildTarGz([
    { name: 'README.md', content: 'hello readme' },
    { name: 'holidaytw', content: 'fake-binary-bytes', mode: 0o755 },
  ]);
  const out = extractFileFromTarGz(gz, 'holidaytw', { maxOutputBytes: 1e6, maxEntryBytes: 1e6 });
  assert.equal(out.toString('utf8'), 'fake-binary-bytes');
});

test('tarExtract: entry order does not matter', () => {
  const gz = buildTarGz([
    { name: 'holidaytw', content: 'binary-content' },
    { name: 'README.md', content: 'hello' },
  ]);
  const out = extractFileFromTarGz(gz, 'holidaytw', {});
  assert.equal(out.toString('utf8'), 'binary-content');
});

test('tarExtract: throws when the target entry is missing', () => {
  const gz = buildTarGz([{ name: 'README.md', content: 'hello' }]);
  assert.throws(() => extractFileFromTarGz(gz, 'holidaytw', {}), TarError);
});

test('tarExtract: rejects path traversal in entry name', () => {
  const gz = buildTarGz([{ name: '../../etc/passwd', content: 'evil' }]);
  assert.throws(() => extractFileFromTarGz(gz, '../../etc/passwd', {}), TarError);
});

test('tarExtract: rejects absolute paths', () => {
  const gz = buildTarGz([{ name: '/etc/passwd', content: 'evil' }]);
  assert.throws(() => extractFileFromTarGz(gz, '/etc/passwd', {}), TarError);
});

test('tarExtract: rejects symlink entries', () => {
  const gz = buildTarGz([{ name: 'holidaytw', typeflag: '2', linkname: '/bin/sh', size: 0 }]);
  assert.throws(() => extractFileFromTarGz(gz, 'holidaytw', {}), TarError);
});

test('tarExtract: rejects hardlink entries', () => {
  const gz = buildTarGz([{ name: 'holidaytw', typeflag: '1', linkname: 'README.md', size: 0 }]);
  assert.throws(() => extractFileFromTarGz(gz, 'holidaytw', {}), TarError);
});

test('tarExtract: rejects character/block device and fifo entries', () => {
  for (const typeflag of ['3', '4', '6']) {
    const gz = buildTarGz([{ name: 'holidaytw', typeflag, size: 0 }]);
    assert.throws(() => extractFileFromTarGz(gz, 'holidaytw', {}), TarError);
  }
});

test('tarExtract: silently allows (skips) directory entries', () => {
  const gz = buildTarGz([
    { name: 'subdir/', typeflag: '5' },
    { name: 'holidaytw', content: 'real-binary' },
  ]);
  const out = extractFileFromTarGz(gz, 'holidaytw', {});
  assert.equal(out.toString('utf8'), 'real-binary');
});

test('tarExtract: rejects duplicate entries for the target name', () => {
  const gz = buildTarGz([
    { name: 'holidaytw', content: 'first' },
    { name: 'holidaytw', content: 'second' },
  ]);
  assert.throws(() => extractFileFromTarGz(gz, 'holidaytw', {}), TarError);
});

test('tarExtract: rejects entries exceeding the configured max entry size', () => {
  const gz = buildTarGz([{ name: 'holidaytw', content: Buffer.alloc(1000, 1) }]);
  assert.throws(() => extractFileFromTarGz(gz, 'holidaytw', { maxEntryBytes: 100 }), TarError);
});

test('tarExtract: enforces maxOutputBytes against gzip/tar decompression bombs', () => {
  const gz = buildTarGz([{ name: 'holidaytw', content: Buffer.alloc(10000, 7) }]);
  assert.throws(() => extractFileFromTarGz(gz, 'holidaytw', { maxOutputBytes: 100 }), TarError);
});

test('tarExtract: rejects a corrupt tar header checksum (malformed archive)', () => {
  const gz = buildTarGzWithBadChecksum([{ name: 'holidaytw', content: 'x', corruptChecksum: true }]);
  assert.throws(() => extractFileFromTarGz(gz, 'holidaytw', {}), TarError);
});

test('tarExtract: rejects a truncated tar archive (header claims more data than present)', () => {
  const gz = buildTarGz([{ name: 'holidaytw', content: 'some content here' }]);
  const tar = zlib.gunzipSync(gz);
  const truncatedTar = tar.subarray(0, tar.length - 600); // chop into the data region
  const truncatedGz = zlib.gzipSync(truncatedTar);
  assert.throws(() => extractFileFromTarGz(truncatedGz, 'holidaytw', {}), TarError);
});

test('tarExtract: rejects a non-gzip buffer', () => {
  const notGzip = Buffer.from('this is not a gzip file at all');
  assert.throws(() => extractFileFromTarGz(notGzip, 'holidaytw', {}), TarError);
});

test('tarExtract: rejects tar whose total size is not a multiple of the block size', () => {
  const gz = buildTarGz([{ name: 'holidaytw', content: 'data' }]);
  const tar = zlib.gunzipSync(gz);
  const malformed = tar.subarray(0, tar.length - 3); // break block alignment
  const malformedGz = zlib.gzipSync(malformed);
  assert.throws(() => extractFileFromTarGz(malformedGz, 'holidaytw', {}), TarError);
});
