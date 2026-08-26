'use strict';

// Centralized validation for test-only environment-variable hooks that
// are honored by BOTH scripts/postinstall.js and lib/launch.js. Kept in
// one place so the two callers can never drift and independently decide
// to trust a dangerous override under different (weaker) conditions.
//
// This covers every environment-level production override: platform,
// architecture, native directory, binary path, release base URL, and
// expected version. Direct function parameters remain available to unit
// tests, but the published postinstall/launcher entrypoints accept these
// environment variables only in explicit test mode.
//
// Overrides are locked behind layered safeguards, applied whenever the
// corresponding value is present:
//   1. Every override requires HOLIDAYTW_TEST_MODE to be exactly '1' --
//      an explicit marker that real installs/launches never set.
//   2. HOLIDAYTW_BASE_URL must be an explicit loopback http(s) URL
//      (localhost / 127.0.0.1 / ::1), so it can only point at a
//      same-machine fake release server started by a test.
//   3. HOLIDAYTW_TEST_EXPECTED_VERSION can only accompany that loopback
//      release URL.
//
// If a test-only override is requested without these safeguards, callers
// fail explicitly. Production behavior is therefore pinned to the real
// GitHub Release URL and expectedVersionString() from config.

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

const TEST_OVERRIDE_KEYS = [
  'HOLIDAYTW_BIN_OVERRIDE',
  'HOLIDAYTW_PLATFORM',
  'HOLIDAYTW_ARCH',
  'HOLIDAYTW_NATIVE_DIR',
  'HOLIDAYTW_BASE_URL',
  'HOLIDAYTW_TEST_EXPECTED_VERSION',
];

/**
 * Resolve all test-only entrypoint overrides. An attempted override
 * outside explicit test mode, or a non-loopback release URL, is an error
 * rather than a silent fallback.
 * @param {NodeJS.ProcessEnv} env
 * @returns {{
 *   binOverride?: string,
 *   platform?: string,
 *   arch?: string,
 *   nativeDir?: string,
 *   baseUrl?: string,
 *   expectedVersionString?: string,
 * }}
 */
function resolveTestOverrides(env) {
  if (!env) return {};
  const requested = TEST_OVERRIDE_KEYS.some((key) => Boolean(env[key]));
  if (!requested) return {};
  if (env.HOLIDAYTW_TEST_MODE !== '1') {
    throw new Error('holidaytw environment overrides are test-only and require HOLIDAYTW_TEST_MODE=1');
  }

  const baseUrl = env.HOLIDAYTW_BASE_URL || undefined;
  if (baseUrl && !isLoopbackHttpUrl(baseUrl)) {
    throw new Error('HOLIDAYTW_BASE_URL is test-only and must be an explicit loopback http(s) URL');
  }

  const expectedVersionString = env.HOLIDAYTW_TEST_EXPECTED_VERSION || undefined;
  if (expectedVersionString && !baseUrl) {
    throw new Error('HOLIDAYTW_TEST_EXPECTED_VERSION requires a loopback HOLIDAYTW_BASE_URL');
  }

  return {
    binOverride: env.HOLIDAYTW_BIN_OVERRIDE || undefined,
    platform: env.HOLIDAYTW_PLATFORM || undefined,
    arch: env.HOLIDAYTW_ARCH || undefined,
    nativeDir: env.HOLIDAYTW_NATIVE_DIR || undefined,
    baseUrl,
    expectedVersionString,
  };
}

module.exports = { resolveTestOverrides, isLoopbackHttpUrl };
