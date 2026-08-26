'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolveTestOverrides, isLoopbackHttpUrl } = require('../lib/testHooks');

test('testHooks: isLoopbackHttpUrl accepts only explicit http(s) loopback URLs', () => {
  assert.equal(isLoopbackHttpUrl('http://127.0.0.1:1234/'), true);
  assert.equal(isLoopbackHttpUrl('http://localhost:1234/'), true);
  assert.equal(isLoopbackHttpUrl('https://LOCALHOST:1234/'), true);
  assert.equal(isLoopbackHttpUrl('http://[::1]:1234/'), true);

  assert.equal(isLoopbackHttpUrl('http://example.com/'), false);
  assert.equal(isLoopbackHttpUrl('http://127.0.0.1.evil.com/'), false);
  assert.equal(isLoopbackHttpUrl('ftp://127.0.0.1/'), false);
  assert.equal(isLoopbackHttpUrl('not a url'), false);
  assert.equal(isLoopbackHttpUrl(''), false);
  assert.equal(isLoopbackHttpUrl(undefined), false);
});

test('resolveTestOverrides: returns overrides only when every safeguard holds', () => {
  const fullyValidEnv = {
    HOLIDAYTW_TEST_MODE: '1',
    HOLIDAYTW_PLATFORM: 'win32',
    HOLIDAYTW_ARCH: 'arm64',
    HOLIDAYTW_NATIVE_DIR: '/tmp/holidaytw-test',
    HOLIDAYTW_BASE_URL: 'http://127.0.0.1:5000/',
    HOLIDAYTW_TEST_EXPECTED_VERSION: 'v20.11.0',
  };
  assert.deepEqual(resolveTestOverrides(fullyValidEnv), {
    binOverride: undefined,
    platform: 'win32',
    arch: 'arm64',
    nativeDir: '/tmp/holidaytw-test',
    baseUrl: 'http://127.0.0.1:5000/',
    expectedVersionString: 'v20.11.0',
  });
});

test('resolveTestOverrides: rejects overrides when HOLIDAYTW_TEST_MODE is not exactly "1"', () => {
  assert.throws(
    () =>
      resolveTestOverrides({
        HOLIDAYTW_BASE_URL: 'http://127.0.0.1:5000/',
      }),
    /require HOLIDAYTW_TEST_MODE=1/
  );
  assert.throws(
    () =>
      resolveTestOverrides({
        HOLIDAYTW_TEST_MODE: 'true',
        HOLIDAYTW_BIN_OVERRIDE: process.execPath,
      }),
    /require HOLIDAYTW_TEST_MODE=1/
  );
});

test('resolveTestOverrides: rejects non-loopback release URLs and incomplete version overrides', () => {
  assert.throws(
    () =>
      resolveTestOverrides({
        HOLIDAYTW_TEST_MODE: '1',
        HOLIDAYTW_BASE_URL: 'https://github.com/doggy8088/holidaybook/releases/download/v2.0.0/',
      }),
    /explicit loopback/
  );
  assert.throws(
    () =>
      resolveTestOverrides({
        HOLIDAYTW_TEST_MODE: '1',
        HOLIDAYTW_TEST_EXPECTED_VERSION: 'v20.11.0',
      }),
    /requires a loopback/
  );
});

test('resolveTestOverrides: returns no overrides for a production environment', () => {
  assert.deepEqual(resolveTestOverrides(undefined), {});
  assert.deepEqual(resolveTestOverrides({}), {});
  assert.deepEqual(resolveTestOverrides({ HOLIDAYTW_TEST_MODE: '1' }), {});
});
