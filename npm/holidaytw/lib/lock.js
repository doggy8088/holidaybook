'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OWNER_FILE = 'owner.json';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH';
  }
}

function readOwner(lockPath) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(lockPath, OWNER_FILE), 'utf8'));
    if (
      !Number.isSafeInteger(value.pid) ||
      value.pid <= 0 ||
      typeof value.token !== 'string' ||
      value.token.length === 0
    ) {
      return null;
    }
    return value;
  } catch (err) {
    if (err.code === 'ENOENT' || err instanceof SyntaxError) return null;
    throw err;
  }
}

function orphanedLockIsOldEnough(lockPath, staleLockMs) {
  try {
    return Date.now() - fs.statSync(lockPath).mtimeMs >= staleLockMs;
  } catch (err) {
    if (err.code === 'ENOENT') return true;
    throw err;
  }
}

function reclaimStaleLock(lockPath, staleLockMs) {
  const owner = readOwner(lockPath);
  if (owner ? processIsAlive(owner.pid) : !orphanedLockIsOldEnough(lockPath, staleLockMs)) {
    return false;
  }

  const stalePath = `${lockPath}.stale-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.renameSync(lockPath, stalePath);
  } catch (err) {
    if (err.code === 'ENOENT') return true;
    throw err;
  }
  fs.rmSync(stalePath, { recursive: true, force: true });
  return true;
}

/**
 * Run `fn` while holding an exclusive directory-based lock at `lockPath`.
 * Directory creation (`mkdir`) is atomic on all platforms Node supports,
 * making this a portable cross-process mutual-exclusion primitive without
 * any native dependency.
 *
 * @param {string} lockPath
 * @param {() => Promise<any>} fn
 * @param {{timeoutMs?: number, retryMs?: number, staleLockMs?: number}} [opts]
 */
async function withLock(lockPath, fn, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const retryMs = opts.retryMs ?? 150;
  const staleLockMs = opts.staleLockMs ?? Math.max(timeoutMs * 2, 120_000);
  const start = Date.now();
  const owner = {
    pid: process.pid,
    token: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };

  for (;;) {
    try {
      fs.mkdirSync(lockPath, { recursive: false });
      try {
        fs.writeFileSync(path.join(lockPath, OWNER_FILE), JSON.stringify(owner), {
          encoding: 'utf8',
          flag: 'wx',
        });
      } catch (err) {
        fs.rmSync(lockPath, { recursive: true, force: true });
        throw err;
      }
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (reclaimStaleLock(lockPath, staleLockMs)) continue;
      if (Date.now() - start >= timeoutMs) {
        throw new Error(
          `Timed out after ${timeoutMs}ms waiting for install lock at ${lockPath}. ` +
            'If no other holidaytw install is running, delete this directory and retry.'
        );
      }
      await sleep(retryMs);
    }
  }

  try {
    return await fn();
  } finally {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

module.exports = { withLock };
