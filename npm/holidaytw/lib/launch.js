'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const config = require('./config');
const { resolveTarget, UnsupportedPlatformError } = require('./platformMatrix');
const { ensureInstalled, fileExistsNonEmpty } = require('./installer');
const { resolveTestOverrides } = require('./testHooks');

// Signals we attempt to forward from this launcher process to the spawned
// native binary. Not all are available on every platform; registering a
// listener for an unsupported signal throws synchronously, so each is
// wrapped defensively.
const FORWARDABLE_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK', 'SIGQUIT'];

/**
 * Resolve which binary to execute. Supports test-only environment
 * variable overrides (HOLIDAYTW_BIN_OVERRIDE / _PLATFORM / _ARCH /
 * _NATIVE_DIR / _BASE_URL); when unset, production defaults apply
 * unchanged. lib/testHooks.js requires explicit test mode and a loopback
 * release URL before any override is honored.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<string>} absolute path to the binary to execute
 */
async function resolveBinaryPath(env) {
  const testOverrides = resolveTestOverrides(env);

  if (testOverrides.binOverride) {
    const override = testOverrides.binOverride;
    if (!fileExistsNonEmpty(override)) {
      throw new Error(`HOLIDAYTW_BIN_OVERRIDE points to a missing or empty file: ${override}`);
    }
    return override;
  }

  const platform = testOverrides.platform || process.platform;
  const arch = testOverrides.arch || process.arch;
  const target = resolveTarget(platform, arch); // throws UnsupportedPlatformError

  const nativeDir = testOverrides.nativeDir || path.join(config.PACKAGE_ROOT, 'native');
  const binPath = path.join(nativeDir, target.key, target.binName);

  if (!fileExistsNonEmpty(binPath)) {
    process.stderr.write('holidaytw: native binary not found; installing now...\n');
    await ensureInstalled({
      platform,
      arch,
      nativeDir,
      baseUrl: testOverrides.baseUrl,
      expectedVersionString: testOverrides.expectedVersionString,
    });
  }
  return binPath;
}

/**
 * Spawn binPath with args, inheriting stdio, and forward termination
 * signals received by this process to the child. Resolves once the child
 * has exited (or failed to launch).
 *
 * binPath is always spawned directly: the real native holidaytw binary
 * is a genuine platform executable (an ELF/Mach-O binary on POSIX, a
 * .exe on Windows), so no shell or interpreter indirection is ever
 * needed or used here.
 *
 * @param {string} binPath
 * @param {string[]} args
 * @returns {Promise<{code: number|null, signal: NodeJS.Signals|null, error?: Error}>}
 */
function forwardAndRun(binPath, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(binPath, args, { stdio: 'inherit', windowsHide: true });
    } catch (err) {
      resolve({ code: null, signal: null, error: err });
      return;
    }

    const listeners = new Map();
    for (const sig of FORWARDABLE_SIGNALS) {
      const listener = () => {
        try {
          child.kill(sig);
        } catch {
          /* ignore: child may already have exited */
        }
      };
      try {
        process.on(sig, listener);
        listeners.set(sig, listener);
      } catch {
        /* signal unsupported on this platform */
      }
    }

    const cleanup = () => {
      for (const [sig, listener] of listeners) {
        try {
          process.removeListener(sig, listener);
        } catch {
          /* ignore */
        }
      }
    };

    child.on('error', (err) => {
      cleanup();
      resolve({ code: null, signal: null, error: err });
    });

    child.on('exit', (code, signal) => {
      cleanup();
      resolve({ code, signal });
    });
  });
}

/**
 * Full CLI entry point logic, extracted from bin/holidaytw.js so it can
 * be exercised directly (and with overrides) in tests.
 *
 * @param {string[]} [argv]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<number>} process exit code
 */
async function main(argv = process.argv.slice(2), env = process.env) {
  let binPath;
  try {
    binPath = await resolveBinaryPath(env);
  } catch (err) {
    if (err instanceof UnsupportedPlatformError) {
      process.stderr.write(`holidaytw: ${err.message}\n`);
      return 1;
    }
    process.stderr.write(`holidaytw: failed to prepare the native holidaytw binary: ${err.message}\n`);
    return 1;
  }

  const result = await forwardAndRun(binPath, argv);

  if (result.error) {
    process.stderr.write(`holidaytw: failed to launch native binary at ${binPath}: ${result.error.message}\n`);
    return 1;
  }

  if (result.signal) {
    // Mirror the child's termination signal on ourselves so the parent
    // shell / process manager observes the same signal-based termination.
    process.once('exit', () => {
      process.kill(process.pid, result.signal);
    });
    return 0;
  }

  return result.code === null ? 1 : result.code;
}

module.exports = { main, resolveBinaryPath, forwardAndRun, FORWARDABLE_SIGNALS };
