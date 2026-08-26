'use strict';

const fs = require('fs');
const path = require('path');

const TMP_ROOT = path.join(__dirname, '..', '.tmp');

/**
 * Create a fresh, uniquely-named scratch directory inside the package's
 * own test/.tmp/ folder (never the OS temp dir). Callers should remove it
 * with removeTmpDir() when done (e.g. in an `after`/`afterEach` hook).
 * @param {string} [prefix]
 * @returns {string} absolute path to the created directory
 */
function makeTmpDir(prefix = 'case-') {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TMP_ROOT, prefix));
}

/**
 * @param {string} dir
 */
function removeTmpDir(dir) {
  if (!dir) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { makeTmpDir, removeTmpDir, TMP_ROOT };
