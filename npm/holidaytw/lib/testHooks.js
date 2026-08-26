'use strict';

// Centralized validation for test-only environment-variable hooks that
// are honored by BOTH scripts/postinstall.js and lib/launch.js. Kept in
// one place so the two callers can never drift and independently decide
// to trust a dangerous override under different (weaker) conditions.
//
// Today this only covers HOLIDAYTW_TEST_EXPECTED_VERSION, which lets
// integration tests substitute a real host-native "fake" binary (e.g. a
// copy of process.execPath on win32, where a plain script cannot be
// executed as a native .exe) for verifyBinaryExecutes()'s exact
// `--version` output check, without weakening the real
// `holidaytw <NATIVE_VERSION>` check that always applies otherwise.
//
// This override is intentionally locked behind three independent
// safeguards, ALL of which must hold, so it can never be triggered by
// accident or by an untrusted/malicious environment in a real install:
//   1. env.HOLIDAYTW_TEST_MODE must be exactly '1' -- an explicit,
//      unmistakably-test-only marker that real installs/launches never
//      set.
//   2. env.HOLIDAYTW_BASE_URL must be an explicit loopback http(s) URL
//      (localhost / 127.0.0.1 / ::1), so this can only ever point at a
//      same-machine fake release server started by a test -- never a
//      real download source.
//   3. env.HOLIDAYTW_TEST_EXPECTED_VERSION must be a nonempty string.
//
// If any condition fails, the override is ignored entirely and the real
// expectedVersionString() (derived from config.NATIVE_VERSION) is used,
// so production behavior is always the strict, real check.

/**
 * @param {string} rawUrl
 * @returns {boolean} true if rawUrl is an explicit http(s) loopback URL
 */
function isLoopbackHttpUrl(rawUrl) {
  if (!rawUrl) return false;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const hostname = parsed.hostname.toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

/**
 * Resolve the test-only expected-`--version`-string override, or
 * `undefined` if any required safeguard is not satisfied (in which case
 * callers must fall back to the real, production expectedVersionString()).
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {string|undefined}
 */
function resolveTestExpectedVersion(env) {
  if (!env || env.HOLIDAYTW_TEST_MODE !== '1') return undefined;
  if (!isLoopbackHttpUrl(env.HOLIDAYTW_BASE_URL)) return undefined;
  const override = env.HOLIDAYTW_TEST_EXPECTED_VERSION;
  if (!override) return undefined;
  return override;
}

module.exports = { resolveTestExpectedVersion, isLoopbackHttpUrl };
