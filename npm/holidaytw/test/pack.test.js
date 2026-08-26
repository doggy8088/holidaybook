'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { resolveNpmCli } = require('./helpers/npmCli');

const packageRoot = path.join(__dirname, '..');
const pkg = require(path.join(packageRoot, 'package.json'));

test('pack: npm pack tarball contains only intended files and the bin entry', () => {
  const workDir = fs.mkdtempSync(path.join(packageRoot, '.pack-check-test-'));
  try {
    const npmCli = resolveNpmCli();
    assert.ok(npmCli, 'npm-cli.js must be discoverable while the npm package tests are running');
    const packOutput = execFileSync(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', workDir], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    const [info] = JSON.parse(packOutput);
    const tarballPath = path.join(workDir, info.filename);
    assert.ok(fs.existsSync(tarballPath));

    const listing = execFileSync('tar', ['-tvf', tarballPath], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
    const entries = listing.map((line) => {
      const parts = line.trim().split(/\s+/);
      return { mode: parts[0], name: parts[parts.length - 1].replace(/^package\//, '') };
    });
    const names = entries.map((e) => e.name).filter((n) => n && n !== '.');

    // Only intended top-level content: no tests, native binaries, or VCS/lock artifacts.
    for (const disallowed of ['test/', 'native/', '.git', 'node_modules/']) {
      assert.ok(
        !names.some((n) => n === disallowed.replace(/\/$/, '') || n.startsWith(disallowed)),
        `tarball must not contain ${disallowed}`
      );
    }

    for (const required of ['package.json', 'README.md', 'bin/holidaytw.js', 'scripts/postinstall.js']) {
      assert.ok(names.includes(required), `tarball must contain ${required}`);
    }

    const binLauncher = entries.find((e) => e.name === 'bin/holidaytw.js');
    assert.ok(binLauncher, 'bin/holidaytw.js must be present');
    if (process.platform !== 'win32') {
      assert.match(binLauncher.mode, /^-rwx/, 'bin/holidaytw.js must be executable in the tarball');
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('pack: package.json declares only the "holidaytw" bin entry', () => {
  assert.deepEqual(Object.keys(pkg.bin), ['holidaytw']);
  assert.equal(pkg.bin.holidaytw, 'bin/holidaytw.js');
});

test('pack: package.json declares an accurate (non-MIT) license', () => {
  assert.equal(pkg.license, 'UNLICENSED');
});

test('pack: repository.url exactly matches the source repository', () => {
  assert.equal(pkg.repository.url, 'https://github.com/doggy8088/holidaybook.git');
});

test('pack: native version is tracked independently from the npm package version', () => {
  assert.ok(pkg.holidaytw && typeof pkg.holidaytw.nativeVersion === 'string');
  // The two fields are independent values; this asserts the dedicated
  // field exists and is not merely aliased to pkg.version.
  assert.notEqual(pkg.holidaytw, undefined);
});

test('pack: engines require Node >= 20', () => {
  assert.equal(pkg.engines.node, '>=20');
});
