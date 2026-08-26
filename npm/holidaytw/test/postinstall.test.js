'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const { createFakeServer } = require('./helpers/server');
const { buildTarGz } = require('./helpers/tarBuilder');
const { buildZip } = require('./helpers/zipBuilder');
const { makeTmpDir, removeTmpDir } = require('./helpers/tmp');
const { resolveTarget } = require('../lib/platformMatrix');

const POSTINSTALL_SCRIPT = path.join(__dirname, '..', 'scripts', 'postinstall.js');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'bin');
const versionOkSrc = fs.readFileSync(path.join(FIXTURE_DIR, 'version-ok'), 'utf8');

// This success test spawns scripts/postinstall.js as a real child
// process, so (unlike test/installer.test.js) there is no way to inject
// a `verifyBinary` function across the process boundary. Instead it
// resolves the target against the REAL host platform/arch and, on
// win32, substitutes a genuine native executable (a copy of
// process.execPath) plus the strictly-guarded HOLIDAYTW_TEST_EXPECTED_VERSION
// override (see lib/testHooks.js), so the underlying OS actually
// executes a real binary on every host.
const HOST_TARGET = resolveTarget(process.platform, process.arch);
const IS_WINDOWS = process.platform === 'win32';

const tmpDir = makeTmpDir('postinstall-');
after(() => removeTmpDir(tmpDir));

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function runPostinstall(envOverrides) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [POSTINSTALL_SCRIPT],
      { env: { ...process.env, ...envOverrides } },
      (error, stdout, stderr) => {
        resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr });
      }
    );
  });
}

function freshNativeDir(label) {
  const dir = path.join(tmpDir, label);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test('postinstall: succeeds (exit 0) and installs the binary from a fake release server', async () => {
  const asset = HOST_TARGET.asset;
  const binContent = IS_WINDOWS ? fs.readFileSync(process.execPath) : versionOkSrc;
  const archive =
    HOST_TARGET.format === 'zip'
      ? buildZip([
          { name: 'README.md', content: 'readme' },
          { name: HOST_TARGET.binName, content: binContent },
        ])
      : buildTarGz([
          { name: 'README.md', content: 'readme' },
          { name: HOST_TARGET.binName, content: binContent, mode: 0o755 },
        ]);
  const checksums = `${sha256(archive)}  ${asset}\n`;

  const { baseUrl, close } = await createFakeServer({
    '/checksums.txt': checksums,
    [`/${asset}`]: archive,
  });
  const nativeDir = freshNativeDir('success');
  try {
    const { code, stdout, stderr } = await runPostinstall({
      HOLIDAYTW_PLATFORM: HOST_TARGET.platform,
      HOLIDAYTW_ARCH: HOST_TARGET.arch,
      HOLIDAYTW_NATIVE_DIR: nativeDir,
      HOLIDAYTW_BASE_URL: baseUrl,
      ...(IS_WINDOWS ? { HOLIDAYTW_TEST_MODE: '1', HOLIDAYTW_TEST_EXPECTED_VERSION: process.version } : {}),
    });
    assert.equal(code, 0, `expected exit 0, got stderr: ${stderr}`);
    assert.match(stdout, /installed native holidaytw binary/);
    assert.equal(fs.existsSync(path.join(nativeDir, HOST_TARGET.key, HOST_TARGET.binName)), true);
  } finally {
    await close();
  }
});

test('postinstall: fails (nonzero exit, actionable stderr) on HTTP 404 and leaves no binary/partial state', async () => {
  const asset = 'holidaytw_linux_amd64.tar.gz';
  const { baseUrl, close } = await createFakeServer({
    '/checksums.txt': { status: 404 },
  });
  const nativeDir = freshNativeDir('http-404');
  try {
    const { code, stderr } = await runPostinstall({
      HOLIDAYTW_PLATFORM: 'linux',
      HOLIDAYTW_ARCH: 'x64',
      HOLIDAYTW_NATIVE_DIR: nativeDir,
      HOLIDAYTW_BASE_URL: baseUrl,
    });
    assert.notEqual(code, 0);
    assert.match(stderr, /failed to install the native holidaytw binary/);
    assert.match(stderr, /re-run your original install command/);
    assert.equal(fs.existsSync(path.join(nativeDir, 'linux-x64', asset)), false);
    if (fs.existsSync(nativeDir)) {
      const entries = fs.readdirSync(nativeDir, { recursive: true });
      assert.ok(!entries.some((e) => e.includes('holidaytw') && !e.endsWith('.lock')));
    }
  } finally {
    await close();
  }
});

test('postinstall: fails (nonzero exit, actionable stderr) on checksum mismatch and leaves no binary', async () => {
  const asset = 'holidaytw_linux_amd64.tar.gz';
  const archive = buildTarGz([{ name: 'holidaytw', content: versionOkSrc }]);
  // Deliberately wrong checksum.
  const checksums = `${'0'.repeat(64)}  ${asset}\n`;

  const { baseUrl, close } = await createFakeServer({
    '/checksums.txt': checksums,
    [`/${asset}`]: archive,
  });
  const nativeDir = freshNativeDir('checksum-mismatch');
  try {
    const { code, stderr } = await runPostinstall({
      HOLIDAYTW_PLATFORM: 'linux',
      HOLIDAYTW_ARCH: 'x64',
      HOLIDAYTW_NATIVE_DIR: nativeDir,
      HOLIDAYTW_BASE_URL: baseUrl,
    });
    assert.notEqual(code, 0);
    assert.match(stderr, /failed to install the native holidaytw binary/);
    assert.equal(fs.existsSync(path.join(nativeDir, 'linux-x64', 'holidaytw')), false);
  } finally {
    await close();
  }
});

test('postinstall: fails (nonzero exit, actionable stderr) for an unsupported platform/arch', async () => {
  const nativeDir = freshNativeDir('unsupported');
  const { code, stderr } = await runPostinstall({
    HOLIDAYTW_PLATFORM: 'freebsd',
    HOLIDAYTW_ARCH: 'x64',
    HOLIDAYTW_NATIVE_DIR: nativeDir,
    HOLIDAYTW_BASE_URL: 'http://127.0.0.1:1/',
  });
  assert.notEqual(code, 0);
  assert.match(stderr, /Unsupported platform\/architecture/);
});
