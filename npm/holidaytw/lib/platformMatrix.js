'use strict';

// Supported release matrix: keys are `${process.platform}-${process.arch}`.
// Asset names must match the exact GoReleaser output names published under
// the GitHub release for NATIVE_TAG (see lib/config.js).
const MATRIX = Object.freeze({
  'darwin-x64': Object.freeze({
    asset: 'holidaytw_darwin_amd64.tar.gz',
    format: 'tar.gz',
    binName: 'holidaytw',
  }),
  'darwin-arm64': Object.freeze({
    asset: 'holidaytw_darwin_arm64.tar.gz',
    format: 'tar.gz',
    binName: 'holidaytw',
  }),
  'linux-x64': Object.freeze({
    asset: 'holidaytw_linux_amd64.tar.gz',
    format: 'tar.gz',
    binName: 'holidaytw',
  }),
  'linux-arm64': Object.freeze({
    asset: 'holidaytw_linux_arm64.tar.gz',
    format: 'tar.gz',
    binName: 'holidaytw',
  }),
  'win32-x64': Object.freeze({
    asset: 'holidaytw_windows_amd64.zip',
    format: 'zip',
    binName: 'holidaytw.exe',
  }),
  'win32-arm64': Object.freeze({
    asset: 'holidaytw_windows_arm64.zip',
    format: 'zip',
    binName: 'holidaytw.exe',
  }),
});

class UnsupportedPlatformError extends Error {
  constructor(platform, arch) {
    const supported = Object.keys(MATRIX).join(', ');
    super(
      `Unsupported platform/architecture combination "${platform}-${arch}". ` +
        `holidaytw only ships prebuilt binaries for: ${supported}. ` +
        'You can build holidaytw from source instead: https://github.com/doggy8088/holidaybook'
    );
    this.name = 'UnsupportedPlatformError';
    this.platform = platform;
    this.arch = arch;
  }
}

/**
 * Resolve the release target for a given platform/arch pair.
 * @param {string} [platform] defaults to process.platform
 * @param {string} [arch] defaults to process.arch
 * @returns {{key: string, platform: string, arch: string, asset: string, format: string, binName: string}}
 */
function resolveTarget(platform = process.platform, arch = process.arch) {
  const key = `${platform}-${arch}`;
  const entry = MATRIX[key];
  if (!entry) {
    throw new UnsupportedPlatformError(platform, arch);
  }
  return { key, platform, arch, ...entry };
}

module.exports = { MATRIX, resolveTarget, UnsupportedPlatformError };
