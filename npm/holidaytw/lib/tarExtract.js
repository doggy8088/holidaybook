'use strict';

const zlib = require('zlib');

class TarError extends Error {}

const BLOCK_SIZE = 512;

function readCString(buf) {
  const idx = buf.indexOf(0);
  const slice = idx === -1 ? buf : buf.subarray(0, idx);
  return slice.toString('utf8');
}

function parseOctalField(buf) {
  // GNU tar can use base-256 encoding for oversized numeric fields (high bit
  // of the first byte set). The GoReleaser archives we support never need
  // this (files are a few MB), so we treat it as unsupported/unsafe.
  if (buf.length > 0 && (buf[0] & 0x80) !== 0) {
    throw new TarError('Unsupported base-256 encoded tar numeric field');
  }
  const str = buf.toString('ascii').replace(/\0.*$/, '').trim();
  if (str.length === 0) return 0;
  const value = parseInt(str, 8);
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    throw new TarError(`Invalid octal numeric field in tar header: ${JSON.stringify(str)}`);
  }
  return value;
}

function validateHeaderChecksum(header) {
  // The checksum field (offset 148, 8 bytes) is computed with that field
  // itself treated as ASCII spaces.
  const recorded = parseOctalField(header.subarray(148, 156));
  let unsignedSum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) {
    const byte = i >= 148 && i < 156 ? 0x20 : header[i];
    unsignedSum += byte;
  }
  if (unsignedSum !== recorded) {
    throw new TarError('Corrupt tar header: checksum mismatch (malformed/truncated archive)');
  }
}

function isZeroBlock(buf) {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

// Regular file typeflags per POSIX ustar / historical tar implementations.
const REGULAR_FILE_TYPEFLAGS = new Set(['0', '\0']);
const DIRECTORY_TYPEFLAG = '5';

/**
 * Extract a single named regular file from a gzip-compressed ustar tar
 * archive buffer, defensively rejecting anything unsafe.
 *
 * @param {Buffer} gzBuffer raw .tar.gz bytes
 * @param {string} targetName exact entry name to extract (e.g. "holidaytw")
 * @param {{maxOutputBytes?: number, maxEntryBytes?: number}} [opts]
 * @returns {Buffer} contents of the target entry
 */
function extractFileFromTarGz(gzBuffer, targetName, opts = {}) {
  const maxOutputBytes = opts.maxOutputBytes ?? 512 * 1024 * 1024;
  const maxEntryBytes = opts.maxEntryBytes ?? 256 * 1024 * 1024;

  let tarBuffer;
  try {
    tarBuffer = zlib.gunzipSync(gzBuffer, { maxOutputLength: maxOutputBytes });
  } catch (err) {
    throw new TarError(`Failed to decompress gzip archive: ${err.message}`);
  }

  if (tarBuffer.length === 0 || tarBuffer.length % BLOCK_SIZE !== 0) {
    throw new TarError('Malformed tar archive: size is not a multiple of the 512-byte block size');
  }

  let offset = 0;
  let found = null;
  const seenNames = new Set();
  let zeroBlockStreak = 0;

  while (offset < tarBuffer.length) {
    if (offset + BLOCK_SIZE > tarBuffer.length) {
      throw new TarError('Truncated tar archive: incomplete header block');
    }
    const header = tarBuffer.subarray(offset, offset + BLOCK_SIZE);

    if (isZeroBlock(header)) {
      zeroBlockStreak++;
      offset += BLOCK_SIZE;
      // Two consecutive zero blocks mark the logical end of the archive.
      if (zeroBlockStreak >= 2) break;
      continue;
    }
    zeroBlockStreak = 0;

    validateHeaderChecksum(header);

    const name = readCString(header.subarray(0, 100));
    const typeflag = String.fromCharCode(header[156]);
    const size = parseOctalField(header.subarray(124, 136));
    const magic = header.subarray(257, 263).toString('ascii');
    const prefix = magic.startsWith('ustar') ? readCString(header.subarray(345, 500)) : '';
    const fullName = prefix ? `${prefix}/${name}` : name;

    if (fullName.length === 0) {
      throw new TarError('Malformed tar entry: empty name');
    }
    if (fullName.startsWith('/') || fullName.split('/').includes('..')) {
      throw new TarError(`Unsafe path in tar entry: ${JSON.stringify(fullName)}`);
    }

    const dataStart = offset + BLOCK_SIZE;
    if (size < 0) {
      throw new TarError(`Malformed tar entry: negative size for ${JSON.stringify(fullName)}`);
    }
    const paddedSize = Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
    const dataEnd = dataStart + size;
    const nextOffset = dataStart + paddedSize;

    if (dataEnd > tarBuffer.length || nextOffset > tarBuffer.length) {
      throw new TarError(`Truncated tar archive: entry data for ${JSON.stringify(fullName)} exceeds archive length`);
    }

    if (typeflag === DIRECTORY_TYPEFLAG) {
      // Directories carry no data; safe to skip.
    } else if (REGULAR_FILE_TYPEFLAGS.has(typeflag)) {
      if (fullName === targetName) {
        if (seenNames.has(fullName)) {
          throw new TarError(`Duplicate tar entry rejected: ${JSON.stringify(fullName)}`);
        }
        seenNames.add(fullName);
        if (size > maxEntryBytes) {
          throw new TarError(
            `Tar entry ${JSON.stringify(fullName)} (${size} bytes) exceeds the maximum allowed size (${maxEntryBytes} bytes)`
          );
        }
        found = Buffer.from(tarBuffer.subarray(dataStart, dataEnd));
      }
    } else {
      // Symlinks ('2'), hardlinks ('1'), char/block devices ('3'/'4'),
      // FIFOs ('6'), GNU long-name ('L'/'K'), PAX headers ('x'/'g'), and any
      // other type are explicitly unsupported/unsafe for this archive format.
      throw new TarError(`Unsupported or unsafe tar entry type ${JSON.stringify(typeflag)} for ${JSON.stringify(fullName)}`);
    }

    offset = nextOffset;
  }

  if (!found) {
    throw new TarError(`Entry ${JSON.stringify(targetName)} not found in tar archive`);
  }
  return found;
}

module.exports = { extractFileFromTarGz, TarError };
