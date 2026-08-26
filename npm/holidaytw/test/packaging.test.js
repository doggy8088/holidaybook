'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { createFakeServer } = require('./helpers/server');
const { buildTarGz } = require('./helpers/tarBuilder');
const { buildZip } = require('./helpers/zipBuilder');
const { makeTmpDir, removeTmpDir } = require('./helpers/tmp');
const { resolveNpmCli, runNpm, runShim } = require('./helpers/npmCli');
const { resolveTarget } = require('../lib/platformMatrix');

// End-to-end packaging/installability smoke tests: these build the REAL
// package tarball with `npm pack`, install it with the REAL npm CLI
// (never `--ignore-scripts`, so the published postinstall genuinely
// runs), and execute the resulting global shim / npx-equivalent
// artifact -- as an actual end user would -- against a local fake
// release server standing in for GitHub Releases. Every other unit test
// in this suite calls this package's own lib/ modules directly; only
// this file exercises the full npm packaging/install/launch pipeline.

const PACKAGE_ROOT = path.join(__dirname, '..');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'bin');
const versionOkSrc = fs.readFileSync(path.join(FIXTURE_DIR, 'version-ok'), 'utf8');

const IS_WINDOWS = process.platform === 'win32';
const HOST_TARGET = resolveTarget(process.platform, process.arch);
const NPM_CLI = resolveNpmCli();
const SKIP_REASON = NPM_CLI ? false : 'npm CLI (npm-cli.js) could not be located relative to this Node install';

const tmpDir = makeTmpDir('packaging-');
after(() => removeTmpDir(tmpDir));

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Flags shared by every npm invocation in this file, chosen so the
 * whole test is hermetic:
 *  - `--cache` / `--userconfig` point inside our own tmp dir, so the
 *    real, potentially credential-bearing user ~/.npmrc (and the real
 *    shared npm cache) is never read or touched.
 *  - `--registry` is deliberately unreachable and `--offline` is set, so
 *    if npm (or anything it spawns) ever attempted to reach the real
 *    npm registry for any reason, that attempt fails loudly instead of
 *    silently succeeding over the network.
 *  - Installing directly from a local tarball path never causes npm to
 *    consult a registry for resolution in the first place; the only
 *    network activity this test performs is our own loopback fake
 *    release server (via HOLIDAYTW_BASE_URL), which stands in for
 *    GitHub Releases. Nothing here can reach the real npm registry or
 *    GitHub.
 * @param {string} dir
 */
function hermeticNpmArgs(dir) {
  return [
    '--cache',
    path.join(dir, 'npm-cache'),
    '--userconfig',
    path.join(dir, 'nonexistent.npmrc'),
    '--registry',
    'http://127.0.0.1:1/unreachable-registry/',
    '--offline',
    '--no-audit',
    '--no-fund',
    '--loglevel=error',
  ];
}

/**
 * Start a local fake release server serving a checksums.txt + archive
 * for the REAL host's target (process.platform/process.arch), so
 * postinstall's real download-and-verify pipeline runs against
 * something that actually matches this host.
 *
 * On POSIX, the archive's binary entry is the existing version-ok
 * fixture (a Node script with a shebang line, directly executable by
 * the OS regardless of file name). On win32, no shebang script is a
 * valid native executable, so a genuine native executable -- a copy of
 * process.execPath (node.exe itself) -- is used instead, paired with
 * the strictly-guarded HOLIDAYTW_TEST_EXPECTED_VERSION override (see
 * lib/testHooks.js and releaseEnv() below) so verifyBinaryExecutes()
 * still performs a real, exact `--version` output check.
 */
function buildFakeRelease() {
  const binContent = IS_WINDOWS ? fs.readFileSync(process.execPath) : versionOkSrc;
  const archive =
    HOST_TARGET.format === 'zip'
      ? buildZip([{ name: HOST_TARGET.binName, content: binContent }])
      : buildTarGz([{ name: HOST_TARGET.binName, content: binContent, mode: 0o755 }]);
  const checksums = `${sha256(archive)}  ${HOST_TARGET.asset}\n`;
  return createFakeServer({
    '/checksums.txt': checksums,
    [`/${HOST_TARGET.asset}`]: archive,
  });
}

/**
 * Environment passed to the spawned npm processes: HOLIDAYTW_BASE_URL
 * points postinstall's real download logic at our local fake server
 * instead of the real GitHub Releases domain. Every platform sets the
 * explicit test marker and loopback URL required by lib/testHooks.js.
 * On win32 only, the nonempty expected-version override additionally
 * lets verification accept node.exe's own `--version` output; every
 * other platform still checks the real `holidaytw <version>` string.
 */
function releaseEnv(baseUrl) {
  return {
    ...process.env,
    HOLIDAYTW_TEST_MODE: '1',
    HOLIDAYTW_BASE_URL: baseUrl,
    ...(IS_WINDOWS ? { HOLIDAYTW_TEST_EXPECTED_VERSION: process.version } : {}),
  };
}

const expectedVersionOutput = IS_WINDOWS ? process.version : 'holidaytw 2.0.0';

async function npmPack(destDir, caseDir) {
  const result = await runNpm(NPM_CLI, ['pack', '--silent', '--pack-destination', destDir, ...hermeticNpmArgs(caseDir)], {
    cwd: PACKAGE_ROOT,
  });
  assert.equal(result.status, 0, `npm pack failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  const tarballName = fs.readdirSync(destDir).find((f) => f.endsWith('.tgz'));
  assert.ok(tarballName, `expected a .tgz in ${destDir}, found: ${fs.readdirSync(destDir)}`);
  // destDir is always absolute (derived from the absolute tmpDir), so
  // this is always an absolute path too -- required for the npm exec
  // test below (see its comment for why that matters).
  return path.join(destDir, tarballName);
}

test(
  'packaging: npm pack -> global install (real postinstall) -> shim runs and reports the expected version',
  { skip: SKIP_REASON },
  async () => {
    const caseDir = path.join(tmpDir, 'global-install');
    const packDir = path.join(caseDir, 'pack');
    const prefixDir = path.join(caseDir, 'prefix');
    fs.mkdirSync(packDir, { recursive: true });
    fs.mkdirSync(prefixDir, { recursive: true });

    // 1. Build the real, published-shape package tarball with `npm pack`.
    const tarballPath = await npmPack(packDir, caseDir);

    // 2. Start the local fake release server for the REAL host target.
    const { baseUrl, close } = await buildFakeRelease();
    try {
      // 3. Install the tarball globally with the actual npm CLI, into an
      // isolated --prefix, WITHOUT --ignore-scripts, so the package's
      // real, published postinstall script genuinely runs (that is the
      // point of this test).
      const installResult = await runNpm(
        NPM_CLI,
        ['install', '--global', tarballPath, '--prefix', prefixDir, ...hermeticNpmArgs(caseDir)],
        { cwd: PACKAGE_ROOT, env: releaseEnv(baseUrl) }
      );
      assert.equal(
        installResult.status,
        0,
        `npm install -g failed:\nstdout: ${installResult.stdout}\nstderr: ${installResult.stderr}`
      );

      // 4. Resolve the shim npm generated for the "holidaytw" bin entry.
      // npm's global-bin layout differs by platform: a `bin/<name>`
      // POSIX executable/symlink, vs. a `<name>.cmd` wrapper directly
      // under the prefix on Windows.
      const shimPath = IS_WINDOWS ? path.join(prefixDir, 'holidaytw.cmd') : path.join(prefixDir, 'bin', 'holidaytw');
      assert.ok(fs.existsSync(shimPath), `expected global shim at ${shimPath}`);

      // 5. Execute the installed shim for real (a genuinely separate
      // process from the postinstall step above) and check its output.
      const shimResult = runShim(shimPath, ['--version']);
      assert.equal(shimResult.status, 0, `shim exited nonzero:\nstdout: ${shimResult.stdout}\nstderr: ${shimResult.stderr}`);
      assert.equal(shimResult.stdout.trim(), expectedVersionOutput);
    } finally {
      await close();
    }
  }
);

test(
  'packaging: npx-equivalent (`npm exec --package <tarball>`) installs and runs holidaytw --version',
  { skip: SKIP_REASON },
  async () => {
    // KNOWN LIMITATION (discovered empirically while writing this test):
    // `npm exec --package <path>` resolves a RELATIVE tarball path
    // against npm's internal exec/install target directory, not against
    // the process's current working directory the way `npm pack` and
    // `npm install -g` do -- passing a cwd-relative path here
    // reproducibly fails with ENOENT even though the file exists
    // relative to cwd. This is a real, reproducible npm CLI path-
    // resolution quirk, not a defect in this package, and is worked
    // around below by always passing an ABSOLUTE tarball path (npmPack()
    // above guarantees this). Because this is the only workaround
    // needed and it is applied unconditionally, this test is NOT
    // skipped/weakened; the global-install/shim test above remains the
    // separately-mandatory source of truth for "can an end user actually
    // install and run this package".
    const caseDir = path.join(tmpDir, 'npm-exec');
    const packDir = path.join(caseDir, 'pack');
    const execPrefixDir = path.join(caseDir, 'exec-prefix');
    fs.mkdirSync(packDir, { recursive: true });
    fs.mkdirSync(execPrefixDir, { recursive: true });

    const tarballPath = await npmPack(packDir, caseDir);

    const { baseUrl, close } = await buildFakeRelease();
    try {
      const execResult = await runNpm(
        NPM_CLI,
        [
          'exec',
          '--yes',
          '--package',
          tarballPath,
          '--prefix',
          execPrefixDir,
          ...hermeticNpmArgs(caseDir),
          '--',
          'holidaytw',
          '--version',
        ],
        { cwd: PACKAGE_ROOT, env: releaseEnv(baseUrl) }
      );
      assert.equal(
        execResult.status,
        0,
        `npm exec failed:\nstdout: ${execResult.stdout}\nstderr: ${execResult.stderr}`
      );
      assert.equal(execResult.stdout.trim(), expectedVersionOutput);
    } finally {
      await close();
    }
  }
);
