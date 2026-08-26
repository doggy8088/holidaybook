'use strict';

const zlib = require('zlib');

const BLOCK_SIZE = 512;

function padOctal(value, length) {
  // length includes the trailing NUL; leave room for it.
  const str = value.toString(8);
  return str.padStart(length - 1, '0') + '\0';
}

function makeHeader({ name, size, typeflag = '0', mode = 0o644, linkname = '' }) {
  const header = Buffer.alloc(BLOCK_SIZE, 0);
  header.write(name, 0, 100, 'utf8');
  header.write(padOctal(mode, 8), 100, 8, 'ascii');
  header.write(padOctal(0, 8), 108, 8, 'ascii'); // uid
  header.write(padOctal(0, 8), 116, 8, 'ascii'); // gid
  header.write(padOctal(size, 12), 124, 12, 'ascii');
  header.write(padOctal(0, 12), 136, 12, 'ascii'); // mtime
  header.write('        ', 148, 8, 'ascii'); // checksum placeholder (8 spaces)
  header.write(typeflag, 156, 1, 'ascii');
  header.write(linkname, 157, 100, 'utf8');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');

  let sum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) sum += header[i];
  header.write(padOctal(sum, 8), 148, 8, 'ascii');

  return header;
}

function padToBlock(buf) {
  const remainder = buf.length % BLOCK_SIZE;
  if (remainder === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(BLOCK_SIZE - remainder, 0)]);
}

/**
 * Build a minimal, valid gzip-compressed ustar tar archive in memory.
 * @param {Array<{name: string, content?: Buffer|string, typeflag?: string, linkname?: string, mode?: number}>} entries
 * @returns {Buffer} gzip-compressed tar bytes
 */
function buildTarGz(entries) {
  const parts = [];
  for (const entry of entries) {
    const content = entry.content ? Buffer.from(entry.content) : Buffer.alloc(0);
    const header = makeHeader({
      name: entry.name,
      size: entry.typeflag && entry.typeflag !== '0' ? entry.size ?? 0 : content.length,
      typeflag: entry.typeflag || '0',
      mode: entry.mode,
      linkname: entry.linkname || '',
    });
    parts.push(header);
    if (content.length > 0) {
      parts.push(padToBlock(content));
    }
  }
  // Two zero blocks mark end of archive.
  parts.push(Buffer.alloc(BLOCK_SIZE * 2, 0));
  const tar = Buffer.concat(parts);
  return zlib.gzipSync(tar);
}

/**
 * Build a tar.gz with a corrupted header checksum for one entry, to test
 * malformed-archive rejection.
 */
function buildTarGzWithBadChecksum(entries) {
  const parts = [];
  for (const entry of entries) {
    const content = entry.content ? Buffer.from(entry.content) : Buffer.alloc(0);
    const header = makeHeader({ name: entry.name, size: content.length, mode: entry.mode });
    if (entry.corruptChecksum) {
      header.write('99999999', 148, 8, 'ascii');
    }
    parts.push(header);
    if (content.length > 0) parts.push(padToBlock(content));
  }
  parts.push(Buffer.alloc(BLOCK_SIZE * 2, 0));
  return zlib.gzipSync(Buffer.concat(parts));
}

module.exports = { buildTarGz, buildTarGzWithBadChecksum, BLOCK_SIZE };
