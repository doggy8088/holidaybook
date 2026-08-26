'use strict';

const path = require('path');

const pkg = require('../package.json');

const PACKAGE_ROOT = path.resolve(__dirname, '..');

function validateNativeMetadata(nativeMeta) {
  if (!nativeMeta || typeof nativeMeta !== 'object' || Array.isArray(nativeMeta)) {
    throw new Error('Invalid package metadata: holidaytw must be an object');
  }

  const nativeVersion = nativeMeta.nativeVersion;
  if (
    typeof nativeVersion !== 'string' ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(nativeVersion)
  ) {
    throw new Error(
      'Invalid package metadata: holidaytw.nativeVersion must be a semantic version without a leading "v"'
    );
  }

  const nativeRepository = nativeMeta.nativeRepository;
  if (
    typeof nativeRepository !== 'string' ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(nativeRepository)
  ) {
    throw new Error('Invalid package metadata: holidaytw.nativeRepository must use the "owner/repository" form');
  }

  return { nativeVersion, nativeRepository };
}

// The native holidaytw release tag is intentionally read from a dedicated
// package.json field (holidaytw.nativeVersion) instead of being derived
// from the top-level npm "version". This decouples the npm package version
// (which may be bumped independently, e.g. for prereleases such as
// 2.0.0-bootstrap.0) from the native GitHub release tag that must be
// downloaded (e.g. v2.0.0).
const {
  nativeVersion: NATIVE_VERSION,
  nativeRepository: NATIVE_REPOSITORY,
} = validateNativeMetadata(pkg.holidaytw);
const NATIVE_TAG = `v${NATIVE_VERSION}`;

const CHECKSUMS_FILENAME = 'checksums.txt';

function defaultBaseUrl() {
  return `https://github.com/${NATIVE_REPOSITORY}/releases/download/${NATIVE_TAG}/`;
}

// Size guards. These are defense-in-depth limits against corrupted or
// malicious archives; they are intentionally generous compared to the real
// ~2-6 MB release assets.
const MAX_CHECKSUMS_BYTES = 1 * 1024 * 1024; // 1 MiB
const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024; // 200 MiB
const MAX_TAR_OUTPUT_BYTES = 512 * 1024 * 1024; // 512 MiB decompressed tar guard
const MAX_ENTRY_BYTES = 256 * 1024 * 1024; // 256 MiB per-extracted-entry guard

const LOCK_TIMEOUT_MS = 60_000;
const LOCK_RETRY_MS = 150;

const DOWNLOAD_TIMEOUT_MS = 60_000;
const VERIFY_TIMEOUT_MS = 10_000;

module.exports = {
  PACKAGE_ROOT,
  NATIVE_VERSION,
  NATIVE_REPOSITORY,
  NATIVE_TAG,
  CHECKSUMS_FILENAME,
  defaultBaseUrl,
  MAX_CHECKSUMS_BYTES,
  MAX_ARCHIVE_BYTES,
  MAX_TAR_OUTPUT_BYTES,
  MAX_ENTRY_BYTES,
  LOCK_TIMEOUT_MS,
  LOCK_RETRY_MS,
  DOWNLOAD_TIMEOUT_MS,
  VERIFY_TIMEOUT_MS,
  validateNativeMetadata,
};
