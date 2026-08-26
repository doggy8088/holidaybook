'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validateNativeMetadata } = require('../lib/config');

test('config: accepts explicit native release metadata', () => {
  assert.deepEqual(
    validateNativeMetadata({
      nativeVersion: '2.0.0',
      nativeRepository: 'doggy8088/holidaybook',
    }),
    {
      nativeVersion: '2.0.0',
      nativeRepository: 'doggy8088/holidaybook',
    }
  );
});

test('config: rejects missing or malformed native release metadata instead of silently defaulting', () => {
  for (const metadata of [
    undefined,
    {},
    { nativeVersion: '', nativeRepository: 'doggy8088/holidaybook' },
    { nativeVersion: 'v2.0.0', nativeRepository: 'doggy8088/holidaybook' },
    { nativeVersion: '2.0.0', nativeRepository: 'https://github.com/doggy8088/holidaybook' },
  ]) {
    assert.throws(() => validateNativeMetadata(metadata), /Invalid package metadata/);
  }
});
