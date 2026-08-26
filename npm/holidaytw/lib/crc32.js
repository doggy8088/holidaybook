'use strict';

// Pure-JS CRC-32 (IEEE 802.3), table-based. Kept dependency-free and
// available uniformly across the supported Node >=20 baseline (unlike
// zlib.crc32, which is only present on newer Node builds).
const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * @param {Buffer|Uint8Array} buf
 * @returns {number} unsigned 32-bit CRC32
 */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

module.exports = { crc32 };
