'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const config = require('./config');
const { resolveTarget } = require('./platformMatrix');
const { parseChecksums, requireChecksum, assertMatches } = require('./checksums');
const { downloadToFile, downloadText } = require('./download');
const { extractFileFromTarGz } = require('./tarExtract');
const { extractFileFromZip } = require('./zipExtract');
const { withLock } = require('./lock');

class InstallError extends Error {}
class VerificationError extends Error {}

function ensureTrailingSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

function fileExistsNonEmpty(p) {
  try {
    const st = fs.statSync(p);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

/**
 * The exact `--version` output the real native holidaytw binary is
 * expected to print (see internal/cli/run.go: `fmt.Fprintf(stdout,
 * "holidaytw %s\n", version)`, with GoReleaser injecting the tag's
 * numeric version via -ldflags). Derived from config.NATIVE_VERSION so
 * it always matches the release tag this package targets.
 * @returns {string}
 */
function expectedVersionString() {
  return `holidaytw ${config.NATIVE_VERSION}`;
}

/**
 * Execute the binary with --version and confirm it both runs
 * successfully AND identifies itself as exactly the expected native
 * holidaytw binary/version. Exiting 0 is not sufficient on its own: an
 * unrelated or malicious executable that happens to exit 0 must still be
 * rejected. Never install/trust a binary that fails this check.
 * @param {string} binPath
 * @param {{timeoutMs?: number, expectedVersionString?: string}} [opts]
 *   `expectedVersionString` is a test-only override of the string
 *   produced by expectedVersionString(); production callers never set it,
 *   so the real "holidaytw <NATIVE_VERSION>" check always applies.
 */
function verifyBinaryExecutes(binPath, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? config.VERIFY_TIMEOUT_MS;
  const result = spawnSync(binPath, ['--version'], {
    timeout: timeoutMs,
    windowsHide: true,
  });
  if (result.error) {
    throw new VerificationError(`Failed to execute ${binPath} --version: ${result.error.message}`);
  }
  if (typeof result.status !== 'number' || result.status !== 0) {
    const stderrText = result.stderr ? result.stderr.toString('utf8').trim() : '';
    throw new VerificationError(
      `Verification failed: ${binPath} --version exited with status ${result.status}${
        stderrText ? ` (${stderrText})` : ''
      }`
    );
  }
  const stdoutText = result.stdout ? result.stdout.toString('utf8').trim() : '';
  const expected = opts.expectedVersionString ?? expectedVersionString();
  if (stdoutText !== expected) {
    throw new VerificationError(
      `Verification failed: ${binPath} --version printed ${JSON.stringify(stdoutText)}, expected exactly ${JSON.stringify(
        expected
      )}`
    );
  }
}

/**
 * Ensure the native holidaytw binary for the current (or overridden)
 * platform/arch is downloaded, verified, and installed. Idempotent and
 * safe to call concurrently from multiple processes.
 *
 * @param {{
 *   platform?: string,
 *   arch?: string,
 *   nativeDir?: string,
 *   baseUrl?: string,
 *   force?: boolean,
 *   fetchImpl?: typeof fetch,
 *   verifyBinary?: (binPath: string, opts?: object) => void,
 *   expectedVersionString?: string,
 * }} [overrides] test-only / advanced hooks. Production defaults are used
 *   whenever a field is omitted. `verifyBinary` (a full replacement for
 *   verifyBinaryExecutes) exists so archive/extraction unit tests can
 *   validate a cross-target fake binary (e.g. a win32 ".exe" entry
 *   extracted from a zip fixture while running on a POSIX host, or vice
 *   versa) without depending on this host's OS being able to directly
 *   execute that fixture's file format; it always still performs a real
 *   subprocess spawn and real stdout/exit-code validation, just via an
 *   explicit interpreter rather than direct OS execution. Production
 *   code never sets this, so the real, direct-execution
 *   verifyBinaryExecutes always runs installs for real. `expectedVersionString`
 *   is forwarded to the default verifyBinaryExecutes (see its docs).
 * @returns {Promise<{binPath: string, installed: boolean, target: string}>}
 */
async function ensureInstalled(overrides = {}) {
  const platform = overrides.platform || process.platform;
  const arch = overrides.arch || process.arch;
  const target = resolveTarget(platform, arch);
  const verifyBinary = overrides.verifyBinary || verifyBinaryExecutes;
  const verifyOpts = { expectedVersionString: overrides.expectedVersionString };

  const nativeRoot = overrides.nativeDir || path.join(config.PACKAGE_ROOT, 'native');
  const installDir = path.join(nativeRoot, target.key);
  const finalBinPath = path.join(installDir, target.binName);

  if (!overrides.force && fileExistsNonEmpty(finalBinPath)) {
    return { binPath: finalBinPath, installed: false, target: target.key };
  }

  fs.mkdirSync(nativeRoot, { recursive: true });
  const lockPath = `${installDir}.lock`;

  return withLock(
    lockPath,
    async () => {
      // Re-check: another process may have completed the install while we
      // were waiting for the lock.
      if (!overrides.force && fileExistsNonEmpty(finalBinPath)) {
        return { binPath: finalBinPath, installed: false, target: target.key };
      }

      const baseUrl = ensureTrailingSlash(overrides.baseUrl || config.defaultBaseUrl());
      const stagingDir = fs.mkdtempSync(path.join(nativeRoot, '.staging-'));

      try {
        const archiveUrl = new URL(target.asset, baseUrl).toString();
        const checksumsUrl = new URL(config.CHECKSUMS_FILENAME, baseUrl).toString();

        const checksumsText = await downloadText(checksumsUrl, {
          maxBytes: config.MAX_CHECKSUMS_BYTES,
          fetchImpl: overrides.fetchImpl,
        });
        const checksumMap = parseChecksums(checksumsText);
        const expectedHash = requireChecksum(checksumMap, target.asset);

        const archivePath = path.join(stagingDir, target.asset);
        await downloadToFile(archiveUrl, archivePath, {
          maxBytes: config.MAX_ARCHIVE_BYTES,
          fetchImpl: overrides.fetchImpl,
        });

        const archiveBuffer = fs.readFileSync(archivePath);
        const actualHash = crypto.createHash('sha256').update(archiveBuffer).digest('hex');
        assertMatches(actualHash, expectedHash, target.asset);

        let binaryBuffer;
        if (target.format === 'tar.gz') {
          binaryBuffer = extractFileFromTarGz(archiveBuffer, target.binName, {
            maxOutputBytes: config.MAX_TAR_OUTPUT_BYTES,
            maxEntryBytes: config.MAX_ENTRY_BYTES,
          });
        } else if (target.format === 'zip') {
          binaryBuffer = extractFileFromZip(archiveBuffer, target.binName, {
            maxEntryBytes: config.MAX_ENTRY_BYTES,
          });
        } else {
          throw new InstallError(`Unknown archive format: ${target.format}`);
        }

        const stagedBinPath = path.join(stagingDir, target.binName);
        fs.writeFileSync(stagedBinPath, binaryBuffer, { mode: 0o755 });
        if (platform !== 'win32') {
          fs.chmodSync(stagedBinPath, 0o755);
        }

        // Never trust an unverified binary: run it before it is installed.
        verifyBinary(stagedBinPath, verifyOpts);

        fs.mkdirSync(installDir, { recursive: true });
        const tmpFinalPath = path.join(installDir, `.${target.binName}.tmp-${process.pid}-${Date.now()}`);
        fs.copyFileSync(stagedBinPath, tmpFinalPath);
        if (platform !== 'win32') {
          fs.chmodSync(tmpFinalPath, 0o755);
        }
        try {
          // POSIX rename atomically replaces an existing file. Windows rename
          // does not, so remove only the locked destination before promoting
          // the already-verified temporary copy.
          if (platform === 'win32') {
            fs.rmSync(finalBinPath, { force: true });
          }
          fs.renameSync(tmpFinalPath, finalBinPath);
        } catch (err) {
          fs.rmSync(tmpFinalPath, { force: true });
          throw err;
        }

        try {
          // Re-verify the installed copy as a final safety net.
          verifyBinary(finalBinPath, verifyOpts);
        } catch (err) {
          // Never leave a binary in place that failed its final,
          // post-install verification: remove the file we just created
          // so no invalid/unverified binary remains installed.
          try {
            fs.unlinkSync(finalBinPath);
          } catch {
            /* best effort */
          }
          throw err;
        }

        return { binPath: finalBinPath, installed: true, target: target.key };
      } finally {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      }
    },
    { timeoutMs: config.LOCK_TIMEOUT_MS, retryMs: config.LOCK_RETRY_MS }
  );
}

module.exports = {
  ensureInstalled,
  verifyBinaryExecutes,
  expectedVersionString,
  fileExistsNonEmpty,
  InstallError,
  VerificationError,
};
