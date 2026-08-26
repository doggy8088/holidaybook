'use strict';

const zlib = require('zlib');
const { crc32 } = require('./crc32');

class ZipError extends Error {}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT_LEN = 65535;

// General-purpose bit flag bits (ZIP APPNOTE 4.4.4).
const GPFLAG_ENCRYPTED = 0x0001;

function findEndOfCentralDirectory(buf) {
  if (buf.length < EOCD_MIN_SIZE) {
    throw new ZipError('Malformed zip: file too small to contain an end-of-central-directory record');
  }
  const searchStart = Math.max(0, buf.length - EOCD_MIN_SIZE - MAX_COMMENT_LEN);
  for (let i = buf.length - EOCD_MIN_SIZE; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      const commentLen = buf.readUInt16LE(i + 20);
      if (i + EOCD_MIN_SIZE + commentLen === buf.length) {
        return i;
      }
    }
  }
  throw new ZipError('End of central directory record not found: not a valid zip file');
}

function normalizeEntryPath(name) {
  return name.replace(/\\/g, '/');
}

function isSafeRelativePath(name) {
  if (name.length === 0) return false;
  if (name.startsWith('/')) return false;
  if (/^[a-zA-Z]:/.test(name)) return false; // Windows drive-letter absolute path
  const segments = name.split('/');
  return !segments.includes('..');
}

/**
 * Extract a single named file from a ZIP archive using its central
 * directory, defensively validating structure/sizes/method/CRC and
 * rejecting anything unsafe.
 *
 * @param {Buffer} zipBuffer raw .zip bytes
 * @param {string} targetName exact entry path to extract (e.g. "holidaytw.exe")
 * @param {{maxEntryBytes?: number}} [opts]
 * @returns {Buffer}
 */
function extractFileFromZip(zipBuffer, targetName, opts = {}) {
  const maxEntryBytes = opts.maxEntryBytes ?? 256 * 1024 * 1024;

  const eocdOffset = findEndOfCentralDirectory(zipBuffer);
  const diskNumber = zipBuffer.readUInt16LE(eocdOffset + 4);
  const cdStartDisk = zipBuffer.readUInt16LE(eocdOffset + 6);
  const entriesOnThisDisk = zipBuffer.readUInt16LE(eocdOffset + 8);
  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const cdSize = zipBuffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipError('ZIP64 archives are not supported');
  }
  // This package only ever extracts single-volume archives produced by
  // GoReleaser/Go's archive/zip. Reject anything claiming to span
  // multiple disks/volumes, or whose per-disk/total entry counts disagree
  // (both are signs of a malformed or deliberately confusing archive).
  if (diskNumber !== 0 || cdStartDisk !== 0 || entriesOnThisDisk !== totalEntries) {
    throw new ZipError('Multi-disk (spanned) zip archives are not supported');
  }
  if (cdOffset + cdSize > zipBuffer.length || cdOffset > eocdOffset) {
    throw new ZipError('Malformed zip: central directory location is out of bounds (corrupt/truncated archive)');
  }

  let pos = cdOffset;
  const cdEnd = cdOffset + cdSize;
  let found = null;
  const seenNames = new Set();

  for (let i = 0; i < totalEntries; i++) {
    if (pos + 46 > cdEnd) {
      throw new ZipError('Truncated zip: central directory entry header exceeds central directory size');
    }
    const sig = zipBuffer.readUInt32LE(pos);
    if (sig !== CEN_SIG) {
      throw new ZipError('Malformed zip: invalid central directory entry signature');
    }
    const gpFlag = zipBuffer.readUInt16LE(pos + 8);
    const method = zipBuffer.readUInt16LE(pos + 10);
    const crcExpected = zipBuffer.readUInt32LE(pos + 16);
    const compSize = zipBuffer.readUInt32LE(pos + 20);
    const uncompSize = zipBuffer.readUInt32LE(pos + 24);
    const nameLen = zipBuffer.readUInt16LE(pos + 28);
    const extraLen = zipBuffer.readUInt16LE(pos + 30);
    const commentLen = zipBuffer.readUInt16LE(pos + 32);
    const externalAttrs = zipBuffer.readUInt32LE(pos + 38);
    const localHeaderOffset = zipBuffer.readUInt32LE(pos + 42);

    const nameStart = pos + 46;
    if (nameStart + nameLen + extraLen + commentLen > cdEnd) {
      throw new ZipError('Truncated zip: central directory entry fields exceed central directory size');
    }
    const rawName = zipBuffer.subarray(nameStart, nameStart + nameLen).toString('utf8');
    const name = normalizeEntryPath(rawName);
    pos = nameStart + nameLen + extraLen + commentLen;

    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new ZipError(`ZIP64 entry not supported: ${JSON.stringify(rawName)}`);
    }
    if (!isSafeRelativePath(name)) {
      throw new ZipError(`Unsafe path in zip entry: ${JSON.stringify(rawName)}`);
    }

    const isDirectory = name.endsWith('/');
    // Unix symlink detection via the upper 16 bits of external attrs
    // (st_mode), matching the Info-ZIP / PKWARE convention used by Go's
    // archive/zip writer. S_IFLNK == 0xA000.
    const unixMode = externalAttrs >>> 16;
    const isSymlink = !isDirectory && (unixMode & 0xf000) === 0xa000;

    if (name === targetName) {
      if (isDirectory) {
        throw new ZipError(`Expected a file but found a directory entry for ${JSON.stringify(targetName)}`);
      }
      if (isSymlink) {
        throw new ZipError(`Refusing to extract symlink entry ${JSON.stringify(targetName)}`);
      }
      if ((gpFlag & GPFLAG_ENCRYPTED) !== 0) {
        throw new ZipError(`Refusing to extract encrypted zip entry ${JSON.stringify(targetName)}`);
      }
      if (seenNames.has(name)) {
        throw new ZipError(`Duplicate zip entry rejected: ${JSON.stringify(targetName)}`);
      }
      seenNames.add(name);
      if (uncompSize > maxEntryBytes) {
        throw new ZipError(
          `Zip entry ${JSON.stringify(targetName)} (${uncompSize} bytes) exceeds the maximum allowed size (${maxEntryBytes} bytes)`
        );
      }
      if (method !== 0 && method !== 8) {
        throw new ZipError(`Unsupported zip compression method ${method} for ${JSON.stringify(targetName)}`);
      }

      if (localHeaderOffset + 30 > zipBuffer.length) {
        throw new ZipError('Malformed zip: local file header is out of bounds');
      }
      const locSig = zipBuffer.readUInt32LE(localHeaderOffset);
      if (locSig !== LOC_SIG) {
        throw new ZipError('Malformed zip: invalid local file header signature');
      }
      const locMethod = zipBuffer.readUInt16LE(localHeaderOffset + 8);
      const locNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
      const locExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
      if (localHeaderOffset + 30 + locNameLen > zipBuffer.length) {
        throw new ZipError('Malformed zip: local file header name field is out of bounds');
      }
      const locRawName = zipBuffer
        .subarray(localHeaderOffset + 30, localHeaderOffset + 30 + locNameLen)
        .toString('utf8');

      // The data-descriptor flag (bit 3) means the local header's own
      // crc/compressed-size/uncompressed-size fields are placeholder
      // zeros (the real values live in a trailing data descriptor and,
      // authoritatively, in the central directory already read above).
      // We intentionally never read those local-header size/CRC fields
      // for integrity decisions -- only the central directory's values
      // are trusted for that. We do, however, cross-check the fields
      // that are always meaningful in the local header regardless of
      // this flag: the compression method and the entry name, which must
      // agree with the central directory to rule out a local header that
      // has been tampered with or swapped relative to the central
      // directory's bookkeeping.
      if (locMethod !== method) {
        throw new ZipError(
          `Malformed zip: local file header compression method (${locMethod}) does not match central directory (${method}) for ${JSON.stringify(
            targetName
          )}`
        );
      }
      if (normalizeEntryPath(locRawName) !== name) {
        throw new ZipError(
          `Malformed zip: local file header name (${JSON.stringify(
            locRawName
          )}) does not match central directory name (${JSON.stringify(targetName)})`
        );
      }

      const dataStart = localHeaderOffset + 30 + locNameLen + locExtraLen;
      const dataEnd = dataStart + compSize;
      if (dataEnd > zipBuffer.length || dataEnd < dataStart) {
        throw new ZipError(`Truncated zip: entry data for ${JSON.stringify(targetName)} exceeds archive length`);
      }

      const compData = zipBuffer.subarray(dataStart, dataEnd);
      let outData;
      if (method === 0) {
        if (compSize !== uncompSize) {
          throw new ZipError(`Malformed zip: stored entry size mismatch for ${JSON.stringify(targetName)}`);
        }
        outData = Buffer.from(compData);
      } else {
        try {
          outData = zlib.inflateRawSync(compData, { maxOutputLength: maxEntryBytes });
        } catch (err) {
          throw new ZipError(`Failed to inflate zip entry ${JSON.stringify(targetName)}: ${err.message}`);
        }
      }

      if (outData.length !== uncompSize) {
        throw new ZipError(`Uncompressed size mismatch for ${JSON.stringify(targetName)}`);
      }
      const actualCrc = crc32(outData);
      if (actualCrc !== (crcExpected >>> 0)) {
        throw new ZipError(`CRC32 mismatch for ${JSON.stringify(targetName)} (corrupt/tampered archive)`);
      }
      found = outData;
    }
  }

  if (pos !== cdEnd) {
    throw new ZipError(
      'Malformed zip: central directory entries do not exactly fill the declared central directory size'
    );
  }

  if (!found) {
    throw new ZipError(`Entry ${JSON.stringify(targetName)} not found in zip archive`);
  }
  return found;
}

module.exports = { extractFileFromZip, ZipError };
