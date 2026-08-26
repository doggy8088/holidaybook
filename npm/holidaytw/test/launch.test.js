'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');

const BIN_PATH = path.join(__dirname, '..', 'bin', 'holidaytw.js');
const FIXTURES = path.join(__dirname, 'fixtures', 'bin');

function runLauncher(args, envOverrides = {}, { onSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN_PATH, ...args], {
      env: { ...process.env, ...envOverrides },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal, stdout, stderr, pid: child.pid }));
    if (onSpawn) onSpawn(child);
  });
}

// These launcher-level tests exercise the REAL production forwardAndRun
// spawn path (via HOLIDAYTW_BIN_OVERRIDE), which always spawns binPath
// directly with no shell/interpreter indirection. To make the fixture
// itself a genuine, directly-spawnable executable on every host
// (including Windows, where a shebang-only script cannot be executed
// directly regardless of file extension), HOLIDAYTW_BIN_OVERRIDE is set
// to process.execPath itself -- Node's own real, always-available
// native executable -- and the canonical fixture script's path is
// prepended to the forwarded argv, so the child process is effectively
// `node <fixture-script> <args...>` on every platform. This requires no
// special-casing in production launch code (no `.cmd`/`.bat` support).
function fixtureScript(name) {
  return path.join(FIXTURES, name);
}

test('launch: forwards arguments to the resolved native binary', async () => {
  const { code, stdout } = await runLauncher([fixtureScript('echo-args'), 'foo', 'bar', '--baz=qux'], {
    HOLIDAYTW_TEST_MODE: '1',
    HOLIDAYTW_BIN_OVERRIDE: process.execPath,
  });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout.trim()), ['foo', 'bar', '--baz=qux']);
});

test('launch: forwards the exact exit code of the native binary', async () => {
  const { code } = await runLauncher([fixtureScript('exit-code'), '7'], {
    HOLIDAYTW_TEST_MODE: '1',
    HOLIDAYTW_BIN_OVERRIDE: process.execPath,
  });
  assert.equal(code, 7);
});

test('launch: forwards exit code 0', async () => {
  const { code } = await runLauncher([fixtureScript('exit-code'), '0'], {
    HOLIDAYTW_TEST_MODE: '1',
    HOLIDAYTW_BIN_OVERRIDE: process.execPath,
  });
  assert.equal(code, 0);
});

test('launch: unsupported platform/arch produces an explicit stderr message and exit code 1', async () => {
  const { code, stderr } = await runLauncher([], {
    HOLIDAYTW_TEST_MODE: '1',
    HOLIDAYTW_PLATFORM: 'freebsd',
    HOLIDAYTW_ARCH: 'x64',
  });
  assert.equal(code, 1);
  assert.match(stderr, /Unsupported platform\/architecture/);
  assert.match(stderr, /freebsd-x64/);
});

test('launch: missing HOLIDAYTW_BIN_OVERRIDE file produces an explicit error and exit code 1', async () => {
  const { code, stderr } = await runLauncher([], {
    HOLIDAYTW_TEST_MODE: '1',
    HOLIDAYTW_BIN_OVERRIDE: path.join(FIXTURES, 'does-not-exist'),
  });
  assert.equal(code, 1);
  assert.match(stderr, /does-not-exist/);
});

test('launch: forwards SIGTERM to the child and mirrors the same termination signal', async () => {
  const { code, signal } = await runLauncher(
    [fixtureScript('sleep'), '5000'],
    { HOLIDAYTW_TEST_MODE: '1', HOLIDAYTW_BIN_OVERRIDE: process.execPath },
    {
      onSpawn(child) {
        setTimeout(() => child.kill('SIGTERM'), 500);
      },
    }
  );
  if (process.platform === 'win32') {
    // Windows has no true POSIX signal delivery: child.kill('SIGTERM')
    // forcibly terminates the process rather than requesting graceful
    // shutdown, and Node does not reliably report back a mirrored signal
    // name the way it does on POSIX. We only assert that the child did
    // not exit with a normal/successful code, proving the kill() call
    // actually terminated it; exact (code, signal) values are
    // intentionally not asserted here since they are not guaranteed.
    assert.notEqual(code, 0);
  } else {
    assert.equal(code, null);
    assert.equal(signal, 'SIGTERM');
  }
});

test('launch: performs a lazy install when the binary is missing, using a local fake release server', async () => {
  const fs = require('fs');
  const crypto = require('crypto');
  const { createFakeServer } = require('./helpers/server');
  const { buildTarGz } = require('./helpers/tarBuilder');
  const { buildZip } = require('./helpers/zipBuilder');
  const { makeTmpDir, removeTmpDir } = require('./helpers/tmp');
  const { resolveTarget } = require('../lib/platformMatrix');

  // Resolve against the REAL host platform/arch (no HOLIDAYTW_PLATFORM
  // override) so this test genuinely exercises the actual target this
  // machine would install, on every CI host (linux/mac/Windows).
  const target = resolveTarget(process.platform, process.arch);

  // This test spawns bin/holidaytw.js as a real child process (it must,
  // to exercise the actual lazy-install code path end-to-end), so a
  // verify function cannot be injected across that process boundary. On
  // POSIX, a plain Node script with a shebang line is directly
  // executable by the OS regardless of file name, so the existing
  // version-ok fixture source works unmodified. On win32, no shebang
  // script (regardless of extension) is a valid native executable, so
  // this test instead uses a real, always-available native executable
  // -- a copy of process.execPath (node.exe itself) -- as the
  // "extracted binary" content, and overrides the expected --version
  // string via the strictly-guarded HOLIDAYTW_TEST_EXPECTED_VERSION hook
  // (see lib/testHooks.js) to match what `node --version` actually
  // prints. This keeps the test's use of ensureInstalled/verifyBinaryExecutes
  // fully real (genuine OS-level execution) on every host.
  const isWindows = process.platform === 'win32';
  const binContent = isWindows
    ? fs.readFileSync(process.execPath)
    : fs.readFileSync(path.join(FIXTURES, 'version-ok'), 'utf8');

  const archive =
    target.format === 'zip'
      ? buildZip([{ name: target.binName, content: binContent }])
      : buildTarGz([{ name: target.binName, content: binContent, mode: 0o755 }]);
  const sha256 = crypto.createHash('sha256').update(archive).digest('hex');

  const { baseUrl, close } = await createFakeServer({
    '/checksums.txt': `${sha256}  ${target.asset}\n`,
    [`/${target.asset}`]: archive,
  });
  const nativeDir = makeTmpDir('launch-lazy-native-');
  try {
    const { code, stderr, stdout } = await runLauncher(['--version'], {
      HOLIDAYTW_TEST_MODE: '1',
      HOLIDAYTW_NATIVE_DIR: nativeDir,
      HOLIDAYTW_BASE_URL: baseUrl,
      // Only takes effect on win32 here; the three safeguards in
      // lib/testHooks.js (test-mode marker + loopback baseUrl + nonempty
      // override) are all satisfied by this test on that platform, and
      // this hook is a no-op everywhere else.
      ...(isWindows ? { HOLIDAYTW_TEST_EXPECTED_VERSION: process.version } : {}),
    });
    assert.equal(code, 0, `expected exit 0, got stderr: ${stderr}`);
    assert.equal(stdout.trim(), isWindows ? process.version : 'holidaytw 2.0.0');
    assert.match(stderr, /installing now/);
  } finally {
    await close();
    removeTmpDir(nativeDir);
  }
});
