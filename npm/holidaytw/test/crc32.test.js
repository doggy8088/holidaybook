'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { crc32 } = require('../lib/crc32');

test('crc32: matches the standard "123456789" test vector (0xCBF43926)', () => {
  assert.equal(crc32(Buffer.from('123456789')).toString(16), 'cbf43926');
});

test('crc32: empty buffer produces 0', () => {
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test('crc32: is deterministic and content-sensitive', () => {
  const a = crc32(Buffer.from('hello'));
  const b = crc32(Buffer.from('hello'));
  const c = crc32(Buffer.from('hellp'));
  assert.equal(a, b);
  assert.notEqual(a, c);
});
