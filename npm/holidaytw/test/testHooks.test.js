'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolveTestExpectedVersion, isLoopbackHttpUrl } = require('../lib/testHooks');

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

test('resolveTestExpectedVersion: returns the override only when every safeguard holds', () => {
  const fullyValidEnv = {
    HOLIDAYTW_TEST_MODE: '1',
    HOLIDAYTW_BASE_URL: 'http://127.0.0.1:5000/',
    HOLIDAYTW_TEST_EXPECTED_VERSION: 'v20.11.0',
  };
  assert.equal(resolveTestExpectedVersion(fullyValidEnv), 'v20.11.0');
});

test('resolveTestExpectedVersion: ignores the override when HOLIDAYTW_TEST_MODE is not exactly "1"', () => {
  assert.equal(
    resolveTestExpectedVersion({
      HOLIDAYTW_BASE_URL: 'http://127.0.0.1:5000/',
      HOLIDAYTW_TEST_EXPECTED_VERSION: 'v20.11.0',
    }),
    undefined
  );
  assert.equal(
    resolveTestExpectedVersion({
      HOLIDAYTW_TEST_MODE: 'true',
      HOLIDAYTW_BASE_URL: 'http://127.0.0.1:5000/',
      HOLIDAYTW_TEST_EXPECTED_VERSION: 'v20.11.0',
    }),
    undefined
  );
});

test('resolveTestExpectedVersion: ignores the override when HOLIDAYTW_BASE_URL is not an explicit loopback URL', () => {
  assert.equal(
    resolveTestExpectedVersion({
      HOLIDAYTW_TEST_MODE: '1',
      HOLIDAYTW_BASE_URL: 'https://github.com/doggy8088/holidaybook/releases/download/v2.0.0/',
      HOLIDAYTW_TEST_EXPECTED_VERSION: 'v20.11.0',
    }),
    undefined
  );
  assert.equal(
    resolveTestExpectedVersion({
      HOLIDAYTW_TEST_MODE: '1',
      HOLIDAYTW_TEST_EXPECTED_VERSION: 'v20.11.0',
    }),
    undefined
  );
});

test('resolveTestExpectedVersion: ignores the override when it is empty/unset', () => {
  assert.equal(
    resolveTestExpectedVersion({
      HOLIDAYTW_TEST_MODE: '1',
      HOLIDAYTW_BASE_URL: 'http://127.0.0.1:5000/',
      HOLIDAYTW_TEST_EXPECTED_VERSION: '',
    }),
    undefined
  );
  assert.equal(
    resolveTestExpectedVersion({
      HOLIDAYTW_TEST_MODE: '1',
      HOLIDAYTW_BASE_URL: 'http://127.0.0.1:5000/',
    }),
    undefined
  );
});

test('resolveTestExpectedVersion: tolerates a missing/undefined env object', () => {
  assert.equal(resolveTestExpectedVersion(undefined), undefined);
  assert.equal(resolveTestExpectedVersion({}), undefined);
});
