#!/usr/bin/env node
'use strict';

// Automatic install of the native holidaytw binary at `npm install` time.
//
// This is a REQUIRED step, not a best-effort one: if the download,
// checksum verification, extraction, or `--version` verification fails
// for any reason, the postinstall script fails loudly (nonzero exit code
// + an actionable stderr message) so `npm install` itself is reported as
// failed. We deliberately do not turn a failed native download into a
// "successful" npm install.
//
// Lazy install (performed by lib/launch.js the first time the CLI is
// actually run) exists only as a fallback for the two cases where this
// script never got a chance to install a working binary at all: the end
// user explicitly skipped lifecycle scripts (`npm install --ignore-scripts`),
// or a previously-installed binary was later removed from outside this
// package's control (a corrupted-but-present binary is not detected or
// reinstalled by the lazy path -- it only checks that a nonempty file
// exists at the expected path, not that it is valid).
//
// Test-only environment variable overrides (unset in production):
// HOLIDAYTW_NATIVE_DIR, HOLIDAYTW_BASE_URL, HOLIDAYTW_PLATFORM,
// HOLIDAYTW_ARCH -- mirrors the same hooks used by lib/launch.js, so
// tests can point this script at a local fake release server instead of
// the real GitHub release. See lib/testHooks.js for the (separately,
// strictly guarded) HOLIDAYTW_TEST_EXPECTED_VERSION hook.

const { ensureInstalled } = require('../lib/installer');
const { resolveTestExpectedVersion } = require('../lib/testHooks');

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<number>} process exit code
 */
async function main(env = process.env) {
  try {
    const result = await ensureInstalled({
      platform: env.HOLIDAYTW_PLATFORM || undefined,
      arch: env.HOLIDAYTW_ARCH || undefined,
      nativeDir: env.HOLIDAYTW_NATIVE_DIR || undefined,
      baseUrl: env.HOLIDAYTW_BASE_URL || undefined,
      expectedVersionString: resolveTestExpectedVersion(env),
    });
    if (result.installed) {
      console.log(`holidaytw: installed native holidaytw binary for ${result.target}.`);
    } else {
      console.log(`holidaytw: native holidaytw binary already present for ${result.target}.`);
    }
    return 0;
  } catch (err) {
    console.error(`holidaytw: failed to install the native holidaytw binary: ${err.message}`);
    console.error(
      'holidaytw: fix the problem above, then re-run your original install command ' +
        '(e.g. "npm install" or "npm install -g holidaytw"). If the package is already ' +
        'present in node_modules, "npm rebuild holidaytw" will also retry just this native ' +
        'install step. You can also install with --ignore-scripts and the CLI will retry the ' +
        'install automatically the first time it is run.'
    );
    return 1;
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

module.exports = { main };
