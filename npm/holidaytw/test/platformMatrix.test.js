'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolveTarget, UnsupportedPlatformError, MATRIX } = require('../lib/platformMatrix');

test('platformMatrix: resolves all six supported targets', () => {
  const expected = {
    'darwin-x64': { asset: 'holidaytw_darwin_amd64.tar.gz', format: 'tar.gz', binName: 'holidaytw' },
    'darwin-arm64': { asset: 'holidaytw_darwin_arm64.tar.gz', format: 'tar.gz', binName: 'holidaytw' },
    'linux-x64': { asset: 'holidaytw_linux_amd64.tar.gz', format: 'tar.gz', binName: 'holidaytw' },
    'linux-arm64': { asset: 'holidaytw_linux_arm64.tar.gz', format: 'tar.gz', binName: 'holidaytw' },
    'win32-x64': { asset: 'holidaytw_windows_amd64.zip', format: 'zip', binName: 'holidaytw.exe' },
    'win32-arm64': { asset: 'holidaytw_windows_arm64.zip', format: 'zip', binName: 'holidaytw.exe' },
  };

  for (const [key, exp] of Object.entries(expected)) {
    const [platform, arch] = key.split('-');
    const target = resolveTarget(platform, arch);
    assert.equal(target.key, key);
    assert.equal(target.asset, exp.asset);
    assert.equal(target.format, exp.format);
    assert.equal(target.binName, exp.binName);
  }

  assert.equal(Object.keys(MATRIX).length, 6);
});

test('platformMatrix: defaults to process.platform/process.arch when unspecified', () => {
  // Not asserting a specific outcome (depends on the host), just that it
  // does not throw for the current host running these tests, or throws a
  // well-typed error if this host genuinely is unsupported.
  try {
    const target = resolveTarget();
    assert.equal(target.platform, process.platform);
    assert.equal(target.arch, process.arch);
  } catch (err) {
    assert.ok(err instanceof UnsupportedPlatformError);
  }
});

test('platformMatrix: throws an explicit, actionable UnsupportedPlatformError for unknown platform/arch', () => {
  assert.throws(
    () => resolveTarget('freebsd', 'x64'),
    (err) => {
      assert.ok(err instanceof UnsupportedPlatformError);
      assert.match(err.message, /Unsupported platform\/architecture/);
      assert.match(err.message, /freebsd-x64/);
      assert.match(err.message, /darwin-x64/); // lists supported targets
      assert.equal(err.platform, 'freebsd');
      assert.equal(err.arch, 'x64');
      return true;
    }
  );
});

test('platformMatrix: throws for a known platform with an unsupported arch', () => {
  assert.throws(() => resolveTarget('linux', 'ia32'), UnsupportedPlatformError);
});
