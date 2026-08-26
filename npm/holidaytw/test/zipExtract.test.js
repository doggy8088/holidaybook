'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { extractFileFromZip, ZipError } = require('../lib/zipExtract');
const { buildZip } = require('./helpers/zipBuilder');

test('zipExtract: extracts the target file alongside other entries (matches GoReleaser layout)', () => {
  const zip = buildZip([
    { name: 'README.md', content: 'hello readme' },
    { name: 'holidaytw.exe', content: 'fake-exe-bytes-'.repeat(20) },
  ]);
  const out = extractFileFromZip(zip, 'holidaytw.exe', {});
  assert.equal(out.toString('utf8'), 'fake-exe-bytes-'.repeat(20));
});

test('zipExtract: supports stored (uncompressed) entries', () => {
  const zip = buildZip([{ name: 'holidaytw.exe', content: 'stored-content', method: 'store' }]);
  const out = extractFileFromZip(zip, 'holidaytw.exe', {});
  assert.equal(out.toString('utf8'), 'stored-content');
});

test('zipExtract: supports deflate entries', () => {
  const zip = buildZip([{ name: 'holidaytw.exe', content: 'deflated-content-'.repeat(50), method: 'deflate' }]);
  const out = extractFileFromZip(zip, 'holidaytw.exe', {});
  assert.equal(out.toString('utf8'), 'deflated-content-'.repeat(50));
});

test('zipExtract: throws when the target entry is missing', () => {
  const zip = buildZip([{ name: 'README.md', content: 'hello' }]);
  assert.throws(() => extractFileFromZip(zip, 'holidaytw.exe', {}), ZipError);
});

test('zipExtract: rejects path traversal in entry name', () => {
  const zip = buildZip([{ name: '../../evil.exe', content: 'evil' }]);
  assert.throws(() => extractFileFromZip(zip, '../../evil.exe', {}), ZipError);
});

test('zipExtract: rejects absolute paths (unix and windows-style)', () => {
  const zipUnix = buildZip([{ name: '/etc/passwd', content: 'evil' }]);
  assert.throws(() => extractFileFromZip(zipUnix, '/etc/passwd', {}), ZipError);

  const zipWin = buildZip([{ name: 'C:/Windows/System32/evil.exe', content: 'evil' }]);
  assert.throws(() => extractFileFromZip(zipWin, 'C:/Windows/System32/evil.exe', {}), ZipError);
});

test('zipExtract: rejects symlink entries', () => {
  const zip = buildZip([{ name: 'holidaytw.exe', content: '/bin/sh', isSymlink: true }]);
  assert.throws(() => extractFileFromZip(zip, 'holidaytw.exe', {}), ZipError);
});

test('zipExtract: rejects a directory when a file was expected', () => {
  const zip = buildZip([{ name: 'holidaytw.exe/', isDir: true }]);
  assert.throws(() => extractFileFromZip(zip, 'holidaytw.exe/', {}), ZipError);
});

test('zipExtract: rejects duplicate entries for the target name', () => {
  const zip = buildZip([
    { name: 'holidaytw.exe', content: 'first' },
    { name: 'holidaytw.exe', content: 'second' },
  ]);
  assert.throws(() => extractFileFromZip(zip, 'holidaytw.exe', {}), ZipError);
});

test('zipExtract: rejects entries exceeding the configured max entry size', () => {
  const zip = buildZip([{ name: 'holidaytw.exe', content: Buffer.alloc(1000, 3) }]);
  assert.throws(() => extractFileFromZip(zip, 'holidaytw.exe', { maxEntryBytes: 100 }), ZipError);
});

test('zipExtract: rejects CRC32 mismatch (corrupted/tampered entry)', () => {
  const zip = buildZip([{ name: 'holidaytw.exe', content: 'important-bytes', corruptCrc: true }]);
  assert.throws(() => extractFileFromZip(zip, 'holidaytw.exe', {}), ZipError);
});

test('zipExtract: rejects declared-size mismatch for stored entries', () => {
  const zip = buildZip([
    { name: 'holidaytw.exe', content: 'abc', method: 'store', overrideUncompSize: 999 },
  ]);
  assert.throws(() => extractFileFromZip(zip, 'holidaytw.exe', {}), ZipError);
});

test('zipExtract: rejects a non-zip / malformed buffer (no EOCD found)', () => {
  const notZip = Buffer.from('this is definitely not a zip archive');
  assert.throws(() => extractFileFromZip(notZip, 'holidaytw.exe', {}), ZipError);
});

test('zipExtract: rejects a truncated zip (central directory beyond file bounds)', () => {
  const zip = buildZip([{ name: 'holidaytw.exe', content: 'binary-content-here' }]);
  const truncated = zip.subarray(0, zip.length - 40);
  assert.throws(() => extractFileFromZip(truncated, 'holidaytw.exe', {}), ZipError);
});

test('zipExtract: rejects unsupported compression methods', () => {
  const zip = buildZip([{ name: 'holidaytw.exe', content: 'abc', method: 'store' }]);
  // Patch the central directory method field (offset 10 within the CEN
  // record) to an unsupported value (e.g. 12 = BZIP2) after building.
  const cenSigIndex = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(cenSigIndex >= 0);
  const patched = Buffer.from(zip);
  patched.writeUInt16LE(12, cenSigIndex + 10);
  assert.throws(() => extractFileFromZip(patched, 'holidaytw.exe', {}), ZipError);
});

test('zipExtract: rejects a multi-disk (spanned) EOCD record', () => {
  const zip = buildZip([{ name: 'holidaytw.exe', content: 'abc', method: 'store' }], { diskNumber: 1 });
  assert.throws(() => extractFileFromZip(zip, 'holidaytw.exe', {}), ZipError);

  const zip2 = buildZip([{ name: 'holidaytw.exe', content: 'abc', method: 'store' }], { cdStartDisk: 1 });
  assert.throws(() => extractFileFromZip(zip2, 'holidaytw.exe', {}), ZipError);
});

test('zipExtract: rejects central directory entry-count inconsistency between disk and total fields', () => {
  const zip = buildZip(
    [
      { name: 'README.md', content: 'hi' },
      { name: 'holidaytw.exe', content: 'abc', method: 'store' },
    ],
    { entriesOnThisDisk: 1 }
  );
  assert.throws(() => extractFileFromZip(zip, 'holidaytw.exe', {}), ZipError);
});

test('zipExtract: rejects an encrypted entry', () => {
  const zip = buildZip([{ name: 'holidaytw.exe', content: 'abc', method: 'store', flags: 0x0001 }]);
  assert.throws(() => extractFileFromZip(zip, 'holidaytw.exe', {}), ZipError);
});

test('zipExtract: rejects central-directory size/count inconsistency (entries do not fill declared central directory size)', () => {
  const zip = buildZip([{ name: 'holidaytw.exe', content: 'abc', method: 'store' }]);
  const eocdSigIndex = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocdSigIndex >= 0);
  const patched = Buffer.from(zip);
  // Inflate the declared central directory size so that, after parsing
  // every entry, `pos` (the true end of parsed entries) stops 4 bytes
  // short of the declared `cdEnd`. The EOCD record itself has enough
  // trailing room that this does not push cdEnd past the buffer length,
  // so only the new entries-vs-declared-size consistency check catches it.
  const declaredSize = patched.readUInt32LE(eocdSigIndex + 12);
  patched.writeUInt32LE(declaredSize + 4, eocdSigIndex + 12);
  assert.throws(() => extractFileFromZip(patched, 'holidaytw.exe', {}), ZipError);
});

test('zipExtract: rejects a target whose local-header filename mismatches the central directory', () => {
  const zip = buildZip([
    { name: 'holidaytw.exe', content: 'abc', method: 'store', localName: 'something-else.exe' },
  ]);
  assert.throws(() => extractFileFromZip(zip, 'holidaytw.exe', {}), ZipError);
});

test('zipExtract: rejects a target whose local-header compression method mismatches the central directory', () => {
  const zip = buildZip([
    { name: 'holidaytw.exe', content: 'deflate-content-'.repeat(20), method: 'deflate', localMethod: 0 },
  ]);
  assert.throws(() => extractFileFromZip(zip, 'holidaytw.exe', {}), ZipError);
});

test('zipExtract: supports the data-descriptor flag (local crc/size fields are placeholder zeros)', () => {
  const zip = buildZip([
    { name: 'holidaytw.exe', content: 'data-descriptor-content', method: 'store', flags: 0x0008 },
  ]);
  const out = extractFileFromZip(zip, 'holidaytw.exe', {});
  assert.equal(out.toString('utf8'), 'data-descriptor-content');
});
