'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { ensureInstalled, verifyBinaryExecutes, VerificationError, expectedVersionString } = require('../lib/installer');
const { DownloadError } = require('../lib/download');
const { ChecksumMismatchError, ChecksumNotFoundError } = require('../lib/checksums');
const { UnsupportedPlatformError } = require('../lib/platformMatrix');
const { createFakeServer } = require('./helpers/server');
const { buildTarGz } = require('./helpers/tarBuilder');
const { buildZip } = require('./helpers/zipBuilder');
const { makeTmpDir, removeTmpDir } = require('./helpers/tmp');
const { nodeInterpretedVerify } = require('./helpers/nodeVerify');

// All archive fixtures below are plain Node scripts (with a shebang line
// Node ignores) rather than genuine platform-native executables. That is
// directly executable via the OS on POSIX hosts, but not on Windows,
// regardless of which platform/arch a given test nominally targets (the
// fixture is always run by *this* host's OS). To keep results
// deterministic on every CI host, tests that only need to prove the
// archive/checksum/extraction/atomic-install pipeline works (as opposed
// to genuine OS-level executable verification, which is covered
// separately below and in test/launch.test.js) inject a `verifyBinary`
// override that spawns the fixture via `node <path> --version` instead
// of asking the OS to execute the file directly.
const verifyViaNode = nodeInterpretedVerify({ expectedVersionString: expectedVersionString(), VerificationError });

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'bin');
const versionOkSrc = fs.readFileSync(path.join(FIXTURE_DIR, 'version-ok'), 'utf8');
const versionFailSrc = fs.readFileSync(path.join(FIXTURE_DIR, 'version-fail'), 'utf8');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const tmpDir = makeTmpDir('installer-');
after(() => removeTmpDir(tmpDir));

function freshNativeDir(label) {
  const dir = path.join(tmpDir, label);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test('installer: happy path installs, verifies, and reports installed=true for linux-x64 (tar.gz)', async () => {
  const asset = 'holidaytw_linux_amd64.tar.gz';
  const archive = buildTarGz([
    { name: 'README.md', content: 'readme contents' },
    { name: 'holidaytw', content: versionOkSrc, mode: 0o755 },
  ]);
  const checksums = `${sha256(archive)}  ${asset}\n`;

  const { baseUrl, close } = await createFakeServer({
    '/checksums.txt': checksums,
    [`/${asset}`]: archive,
  });
  try {
    const nativeDir = freshNativeDir('happy-tar');
    const result = await ensureInstalled({
      platform: 'linux',
      arch: 'x64',
      nativeDir,
      baseUrl,
      verifyBinary: verifyViaNode,
    });
    assert.equal(result.installed, true);
    assert.equal(result.target, 'linux-x64');
    assert.ok(fs.existsSync(result.binPath));
    if (process.platform !== 'win32') {
      const stat = fs.statSync(result.binPath);
      assert.ok(stat.mode & 0o111, 'installed binary should be executable');
    }

    // No leftover staging/lock artifacts.
    const entries = fs.readdirSync(nativeDir);
    assert.ok(!entries.some((e) => e.startsWith('.staging-')), `unexpected staging dir left behind: ${entries}`);
    assert.ok(!entries.some((e) => e.endsWith('.lock')), `unexpected lock dir left behind: ${entries}`);
  } finally {
    await close();
  }
});

test('installer: happy path installs a zip-format target (win32-x64)', async () => {
  const asset = 'holidaytw_windows_amd64.zip';
  const archive = buildZip([
    { name: 'README.md', content: 'readme contents' },
    { name: 'holidaytw.exe', content: versionOkSrc },
  ]);
  const checksums = `${sha256(archive)}  ${asset}\n`;

  const { baseUrl, close } = await createFakeServer({
    '/checksums.txt': checksums,
    [`/${asset}`]: archive,
  });
  try {
    const nativeDir = freshNativeDir('happy-zip');
    const result = await ensureInstalled({
      platform: 'win32',
      arch: 'x64',
      nativeDir,
      baseUrl,
      // See the top-of-file comment: this fixture is JS source, not a
      // real PE executable, so it cannot be run directly by a real
      // Windows host either. node-interpreted verification proves the
      // archive/extraction pipeline for a zip target without depending
      // on OS-level ".exe" execution.
      verifyBinary: verifyViaNode,
    });
    assert.equal(result.installed, true);
    assert.ok(fs.existsSync(result.binPath));
    assert.match(result.binPath, /holidaytw\.exe$/);
  } finally {
    await close();
  }
});

test('installer: win32 repair removes an empty destination before promotion', async () => {
  const asset = 'holidaytw_windows_amd64.zip';
  const archive = buildZip([{ name: 'holidaytw.exe', content: versionOkSrc }]);
  const checksums = `${sha256(archive)}  ${asset}\n`;

  const { baseUrl, close } = await createFakeServer({
    '/checksums.txt': checksums,
    [`/${asset}`]: archive,
  });
  const nativeDir = freshNativeDir('win32-empty-repair');
  const installDir = path.join(nativeDir, 'win32-x64');
  const finalBinPath = path.join(installDir, 'holidaytw.exe');
  fs.mkdirSync(installDir, { recursive: true });
  fs.writeFileSync(finalBinPath, '');

  const originalRenameSync = fs.renameSync;
  let promotionCalls = 0;
  fs.renameSync = function windowsRename(source, destination) {
    if (destination === finalBinPath) {
      promotionCalls += 1;
      if (fs.existsSync(destination)) {
        const err = new Error('simulated Windows rename refusal for an existing destination');
        err.code = 'EEXIST';
        throw err;
      }
    }
    return originalRenameSync(source, destination);
  };

  try {
    const result = await ensureInstalled({
      platform: 'win32',
      arch: 'x64',
      nativeDir,
      baseUrl,
      verifyBinary: verifyViaNode,
    });

    assert.equal(result.installed, true);
    assert.equal(promotionCalls, 1);
    assert.equal(fs.readFileSync(finalBinPath, 'utf8'), versionOkSrc);
    assert.deepEqual(fs.readdirSync(installDir), ['holidaytw.exe']);
  } finally {
    fs.renameSync = originalRenameSync;
    await close();
  }
});

test('installer: is idempotent once a valid binary is present (no re-download)', async () => {
  const asset = 'holidaytw_linux_amd64.tar.gz';
  const archive = buildTarGz([{ name: 'holidaytw', content: versionOkSrc }]);
  const checksums = `${sha256(archive)}  ${asset}\n`;

  const { baseUrl, close } = await createFakeServer({
    '/checksums.txt': checksums,
    [`/${asset}`]: archive,
  });
  const nativeDir = freshNativeDir('idempotent');
  try {
    const first = await ensureInstalled({ platform: 'linux', arch: 'x64', nativeDir, baseUrl, verifyBinary: verifyViaNode });
    assert.equal(first.installed, true);
  } finally {
    await close();
  }

  // Server is now closed; a bogus baseUrl proves no network call is made.
  const second = await ensureInstalled({
    platform: 'linux',
    arch: 'x64',
    nativeDir,
    baseUrl: 'http://127.0.0.1:1/should-not-be-used/',
  });
  assert.equal(second.installed, false);
  assert.equal(second.binPath, path.join(nativeDir, 'linux-x64', 'holidaytw'));
});

test('installer: rejects on SHA-256 mismatch and leaves no installed binary', async () => {
  const asset = 'holidaytw_linux_amd64.tar.gz';
  const archive = buildTarGz([{ name: 'holidaytw', content: versionOkSrc }]);
  const wrongHash = '0'.repeat(64);
  const checksums = `${wrongHash}  ${asset}\n`;

  const { baseUrl, close } = await createFakeServer({
    '/checksums.txt': checksums,
    [`/${asset}`]: archive,
  });
  try {
    const nativeDir = freshNativeDir('sha-mismatch');
    await assert.rejects(
      ensureInstalled({ platform: 'linux', arch: 'x64', nativeDir, baseUrl }),
      ChecksumMismatchError
    );
    assert.equal(fs.existsSync(path.join(nativeDir, 'linux-x64', 'holidaytw')), false);
  } finally {
    await close();
  }
});

test('installer: rejects when checksums.txt has no entry for the asset', async () => {
  const asset = 'holidaytw_linux_amd64.tar.gz';
  const archive = buildTarGz([{ name: 'holidaytw', content: versionOkSrc }]);
  const checksums = `${sha256(archive)}  some-other-file.tar.gz\n`;

  const { baseUrl, close } = await createFakeServer({
    '/checksums.txt': checksums,
    [`/${asset}`]: archive,
  });
  try {
    const nativeDir = freshNativeDir('missing-entry');
    await assert.rejects(
      ensureInstalled({ platform: 'linux', arch: 'x64', nativeDir, baseUrl }),
      ChecksumNotFoundError
    );
  } finally {
    await close();
  }
});

test('installer: rejects with an explicit error on HTTP 404 for the archive', async () => {
  const asset = 'holidaytw_linux_amd64.tar.gz';
  const { baseUrl, close } = await createFakeServer({
    '/checksums.txt': `${'a'.repeat(64)}  ${asset}\n`,
    [`/${asset}`]: { status: 404 },
  });
  try {
    const nativeDir = freshNativeDir('http-404');
    await assert.rejects(ensureInstalled({ platform: 'linux', arch: 'x64', nativeDir, baseUrl }), DownloadError);
  } finally {
    await close();
  }
});

test('installer: rejects and cleans up when the extracted binary fails --version verification', async () => {
  const asset = 'holidaytw_linux_amd64.tar.gz';
  const archive = buildTarGz([{ name: 'holidaytw', content: versionFailSrc }]);
  const checksums = `${sha256(archive)}  ${asset}\n`;

  const { baseUrl, close } = await createFakeServer({
    '/checksums.txt': checksums,
    [`/${asset}`]: archive,
  });
  try {
    const nativeDir = freshNativeDir('verify-fail');
    await assert.rejects(
      ensureInstalled({ platform: 'linux', arch: 'x64', nativeDir, baseUrl, verifyBinary: verifyViaNode }),
      VerificationError
    );
    assert.equal(fs.existsSync(path.join(nativeDir, 'linux-x64', 'holidaytw')), false);
    // No staging directory left behind either.
    if (fs.existsSync(nativeDir)) {
      const entries = fs.readdirSync(nativeDir);
      assert.ok(!entries.some((e) => e.startsWith('.staging-')));
    }
  } finally {
    await close();
  }
});

test('installer: rejects a binary that exits 0 but prints unexpected --version output', async () => {
  const versionWrongOutputSrc = fs.readFileSync(path.join(FIXTURE_DIR, 'version-wrong-output'), 'utf8');
  const asset = 'holidaytw_linux_amd64.tar.gz';
  const archive = buildTarGz([{ name: 'holidaytw', content: versionWrongOutputSrc }]);
  const checksums = `${sha256(archive)}  ${asset}\n`;

  const { baseUrl, close } = await createFakeServer({
    '/checksums.txt': checksums,
    [`/${asset}`]: archive,
  });
  try {
    const nativeDir = freshNativeDir('verify-wrong-output');
    await assert.rejects(
      ensureInstalled({ platform: 'linux', arch: 'x64', nativeDir, baseUrl, verifyBinary: verifyViaNode }),
      VerificationError
    );
    assert.equal(fs.existsSync(path.join(nativeDir, 'linux-x64', 'holidaytw')), false);
  } finally {
    await close();
  }
});

test('installer: removes the final installed binary if post-rename verification fails, leaving none behind', async () => {
  const versionFlakySrc = fs.readFileSync(path.join(FIXTURE_DIR, 'version-flaky'), 'utf8');
  const asset = 'holidaytw_linux_amd64.tar.gz';
  const archive = buildTarGz([{ name: 'holidaytw', content: versionFlakySrc }]);
  const checksums = `${sha256(archive)}  ${asset}\n`;

  const { baseUrl, close } = await createFakeServer({
    '/checksums.txt': checksums,
    [`/${asset}`]: archive,
  });
  const nativeDir = freshNativeDir('verify-flaky');
  const counterFile = path.join(tmpDir, 'verify-flaky-counter.txt');
  fs.rmSync(counterFile, { force: true });
  const prevCounterEnv = process.env.HOLIDAYTW_FLAKY_COUNTER_FILE;
  process.env.HOLIDAYTW_FLAKY_COUNTER_FILE = counterFile;
  try {
    // 1st --version call (staged copy) succeeds; 2nd call (final,
    // renamed copy) prints a corrupted version string and must be
    // rejected, with the newly-installed file removed afterward.
    await assert.rejects(
      ensureInstalled({ platform: 'linux', arch: 'x64', nativeDir, baseUrl, verifyBinary: verifyViaNode }),
      VerificationError
    );
    assert.equal(fs.existsSync(path.join(nativeDir, 'linux-x64', 'holidaytw')), false);
    assert.equal(fs.readFileSync(counterFile, 'utf8'), '2');
  } finally {
    if (prevCounterEnv === undefined) {
      delete process.env.HOLIDAYTW_FLAKY_COUNTER_FILE;
    } else {
      process.env.HOLIDAYTW_FLAKY_COUNTER_FILE = prevCounterEnv;
    }
    await close();
  }
});

test('installer: rejects unsupported platform/arch before attempting any network activity', async () => {
  const nativeDir = freshNativeDir('unsupported');
  await assert.rejects(
    ensureInstalled({ platform: 'freebsd', arch: 'x64', nativeDir, baseUrl: 'http://127.0.0.1:1/' }),
    UnsupportedPlatformError
  );
});

test('installer: concurrent installs for the same target do not corrupt the result', async () => {
  const asset = 'holidaytw_linux_amd64.tar.gz';
  const archive = buildTarGz([{ name: 'holidaytw', content: versionOkSrc }]);
  const checksums = `${sha256(archive)}  ${asset}\n`;

  const { baseUrl, close } = await createFakeServer({
    '/checksums.txt': checksums,
    [`/${asset}`]: archive,
  });
  try {
    const nativeDir = freshNativeDir('concurrent');
    const [a, b, c] = await Promise.all([
      ensureInstalled({ platform: 'linux', arch: 'x64', nativeDir, baseUrl, verifyBinary: verifyViaNode }),
      ensureInstalled({ platform: 'linux', arch: 'x64', nativeDir, baseUrl, verifyBinary: verifyViaNode }),
      ensureInstalled({ platform: 'linux', arch: 'x64', nativeDir, baseUrl, verifyBinary: verifyViaNode }),
    ]);
    for (const r of [a, b, c]) {
      assert.equal(r.binPath, path.join(nativeDir, 'linux-x64', 'holidaytw'));
    }
    assert.ok(fs.existsSync(a.binPath));
    const entries = fs.readdirSync(nativeDir);
    assert.ok(!entries.some((e) => e.startsWith('.staging-')));
    assert.ok(!entries.some((e) => e.endsWith('.lock')));
  } finally {
    await close();
  }
});

test('verifyBinaryExecutes: performs a genuine real host-native executable verification (no archive, no injection)', () => {
  // Unlike every test above (which necessarily fakes archive/binary
  // content since this suite doesn't ship real per-platform holidaytw
  // binaries), this test calls the real, unmodified verifyBinaryExecutes
  // directly against process.execPath -- Node's own executable, which is
  // an inherently real, valid, natively-executable program on every host
  // this test can possibly run on (mac/linux/Windows). This guarantees
  // at least one test in this suite proves direct OS-level execution +
  // exact stdout matching actually works on the real host, not merely
  // via the node-interpreted indirection used elsewhere in this file.
  assert.doesNotThrow(() => {
    verifyBinaryExecutes(process.execPath, { expectedVersionString: process.version });
  });

  assert.throws(() => {
    verifyBinaryExecutes(process.execPath, { expectedVersionString: 'definitely-not-the-real-version' });
  }, VerificationError);
});
