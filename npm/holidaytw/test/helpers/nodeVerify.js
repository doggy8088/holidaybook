'use strict';

const { spawnSync } = require('child_process');

/**
 * Build a lib/installer.js-compatible `verifyBinary` override that runs
 * the "extracted binary" via an explicit `node <path> --version`
 * invocation instead of asking the OS to execute the file directly.
 *
 * All of this package's archive-format installer tests use plain Node
 * script source (with a `#!/usr/bin/env node` shebang line, which Node
 * itself simply ignores) as fixture content for the binary entry inside
 * the fake tar.gz/zip archives. That content is genuinely executable via
 * direct OS invocation on POSIX platforms (the kernel reads the shebang
 * line), but not on Windows -- which cannot execute a shebang script or
 * arbitrary ".exe"-named text content directly, regardless of which
 * platform/arch the test is nominally exercising (linux-x64, win32-x64,
 * etc. are all just labels; the file is always executed by the actual
 * host OS running the test).
 *
 * Using this override keeps every other step of ensureInstalled() fully
 * real (download, checksum verification, extraction, atomic install,
 * locking) and still performs a real subprocess spawn + real stdout/exit
 * code validation for the final verification step -- it only changes
 * *how* the process is launched (via an explicit interpreter) so the
 * check is deterministic on every host, not just POSIX ones. Production
 * code (lib/launch.js, scripts/postinstall.js) never uses this: it
 * always calls the real, direct-execution verifyBinaryExecutes.
 *
 * @param {{expectedVersionString: string, VerificationError: typeof Error}} deps
 * @returns {(binPath: string, opts?: {timeoutMs?: number}) => void}
 */
function nodeInterpretedVerify({ expectedVersionString, VerificationError }) {
  return function verify(binPath, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 10_000;
    const result = spawnSync(process.execPath, [binPath, '--version'], {
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
    if (stdoutText !== expectedVersionString) {
      throw new VerificationError(
        `Verification failed: ${binPath} --version printed ${JSON.stringify(
          stdoutText
        )}, expected exactly ${JSON.stringify(expectedVersionString)}`
      );
    }
  };
}

module.exports = { nodeInterpretedVerify };
