'use strict';

const zlib = require('zlib');
const { crc32 } = require('../../lib/crc32');

const LOC_SIG = 0x04034b50;
const CEN_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

const S_IFLNK = 0xa000;
const S_IFREG = 0x8000;
const S_IFDIR = 0x4000;

/**
 * Build a minimal, valid ZIP archive in memory using local file headers +
 * a central directory + EOCD record, matching what Go's archive/zip (and
 * therefore GoReleaser) produces closely enough for extraction tests.
 *
 * @param {Array<{
 *   name: string,
 *   content?: Buffer|string,
 *   method?: 'store'|'deflate',
 *   isDir?: boolean,
 *   isSymlink?: boolean,
 *   unixMode?: number,
 *   corruptCrc?: boolean,
 *   overrideUncompSize?: number,
 *   flags?: number,
 *   localName?: string,
 *   localMethod?: number,
 * }>} entries
 * @param {{
 *   diskNumber?: number,
 *   cdStartDisk?: number,
 *   entriesOnThisDisk?: number,
 *   totalEntries?: number,
 * }} [eocdOverrides] test-only knobs for constructing malformed/multi-disk
 *   EOCD records.
 * @returns {Buffer}
 */
function buildZip(entries, eocdOverrides = {}) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const content = entry.isDir ? Buffer.alloc(0) : Buffer.from(entry.content || '');
    const method = entry.method === 'store' ? METHOD_STORE : METHOD_DEFLATE;
    const flags = entry.flags ?? 0;

    let compData;
    if (entry.isDir) {
      compData = Buffer.alloc(0);
    } else if (method === METHOD_STORE) {
      compData = content;
    } else {
      compData = zlib.deflateRawSync(content);
    }

    const crc = entry.corruptCrc ? (crc32(content) ^ 0xffffffff) >>> 0 : crc32(content);
    const uncompSize = entry.overrideUncompSize ?? content.length;

    const localNameBuf = Buffer.from(entry.localName ?? entry.name, 'utf8');
    const localMethod = entry.localMethod ?? (entry.isDir ? METHOD_STORE : method);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(LOC_SIG, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(flags, 6); // flags
    localHeader.writeUInt16LE(localMethod, 8);
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    // When the data-descriptor bit (0x0008) is set, real zip writers put
    // zero placeholders here and store the true crc/sizes in a trailing
    // data descriptor after the entry data instead. Mirror that so tests
    // can confirm extraction relies only on the central directory (which
    // always carries the real values) and never requires these fields.
    const hasDataDescriptor = (flags & 0x0008) !== 0;
    localHeader.writeUInt32LE(hasDataDescriptor ? 0 : crc, 14);
    localHeader.writeUInt32LE(hasDataDescriptor ? 0 : compData.length, 18);
    localHeader.writeUInt32LE(hasDataDescriptor ? 0 : uncompSize, 22);
    localHeader.writeUInt16LE(localNameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra length

    const localHeaderOffset = offset;
    localParts.push(localHeader, localNameBuf, compData);
    offset += localHeader.length + localNameBuf.length + compData.length;

    let unixMode = entry.unixMode;
    if (unixMode === undefined) {
      unixMode = entry.isSymlink ? (S_IFLNK | 0o777) : entry.isDir ? (S_IFDIR | 0o755) : (S_IFREG | 0o644);
    }
    const externalAttrs = (unixMode << 16) >>> 0;

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(CEN_SIG, 0);
    centralHeader.writeUInt16LE(0x031e, 4); // version made by (unix)
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(entry.isDir ? METHOD_STORE : method, 10);
    centralHeader.writeUInt16LE(0, 12); // mod time
    centralHeader.writeUInt16LE(0, 14); // mod date
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compData.length, 20);
    centralHeader.writeUInt32LE(uncompSize, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(externalAttrs, 38);
    centralHeader.writeUInt32LE(localHeaderOffset, 42);

    centralParts.push(centralHeader, nameBuf);
  }

  const centralDirStart = offset;
  const centralBuf = Buffer.concat(centralParts);
  const centralDirSize = centralBuf.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(eocdOverrides.diskNumber ?? 0, 4); // disk number
  eocd.writeUInt16LE(eocdOverrides.cdStartDisk ?? 0, 6); // disk with central dir
  eocd.writeUInt16LE(eocdOverrides.entriesOnThisDisk ?? entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(eocdOverrides.totalEntries ?? entries.length, 10); // total entries
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirStart, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

module.exports = { buildZip };
