'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { withLock } = require('../lib/lock');
const { makeTmpDir, removeTmpDir } = require('./helpers/tmp');

function writeOwner(lockPath, pid, token = 'test-owner') {
  fs.mkdirSync(lockPath);
  fs.writeFileSync(
    path.join(lockPath, 'owner.json'),
    JSON.stringify({ pid, token, createdAt: new Date().toISOString() })
  );
}

test('lock: creates ownership metadata and removes the lock after success', async () => {
  const dir = makeTmpDir('lock-success-');
  const lockPath = path.join(dir, 'install.lock');
  try {
    const result = await withLock(lockPath, async () => {
      const owner = JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8'));
      assert.equal(owner.pid, process.pid);
      assert.ok(owner.token);
      return 'done';
    });
    assert.equal(result, 'done');
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    removeTmpDir(dir);
  }
});

test('lock: reclaims a lock whose owner process has exited', async () => {
  const dir = makeTmpDir('lock-dead-owner-');
  const lockPath = path.join(dir, 'install.lock');
  try {
    const exited = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    assert.ok(Number.isSafeInteger(exited.pid) && exited.pid > 0);
    writeOwner(lockPath, exited.pid);

    let ran = false;
    await withLock(
      lockPath,
      async () => {
        ran = true;
      },
      { timeoutMs: 100, retryMs: 5 }
    );
    assert.equal(ran, true);
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    removeTmpDir(dir);
  }
});

test('lock: reclaims an old ownerless lock but never steals a live lock', async () => {
  const dir = makeTmpDir('lock-orphan-');
  const orphanPath = path.join(dir, 'orphan.lock');
  const livePath = path.join(dir, 'live.lock');
  try {
    fs.mkdirSync(orphanPath);
    const old = new Date(Date.now() - 10_000);
    fs.utimesSync(orphanPath, old, old);
    await withLock(orphanPath, async () => {}, {
      timeoutMs: 100,
      retryMs: 5,
      staleLockMs: 1_000,
    });
    assert.equal(fs.existsSync(orphanPath), false);

    writeOwner(livePath, process.pid);
    await assert.rejects(
      withLock(livePath, async () => {}, {
        timeoutMs: 25,
        retryMs: 5,
        staleLockMs: 0,
      }),
      /Timed out/
    );
    assert.equal(fs.existsSync(livePath), true);
  } finally {
    removeTmpDir(dir);
  }
});
