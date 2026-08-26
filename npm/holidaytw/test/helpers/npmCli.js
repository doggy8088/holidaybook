'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

/**
 * Resolve an absolute path to the real npm CLI's JS entrypoint
 * (npm-cli.js), so it can be invoked portably as
 * `spawnSync(process.execPath, [npmCliPath, ...args])` -- i.e. running
 * npm through the SAME node binary running these tests, with no need to
 * locate/spawn a platform-specific `npm`/`npm.cmd` shell wrapper and no
 * shell-string parsing involved.
 *
 * Preferred source: `process.env.npm_execpath`, which npm itself sets
 * for any script/process it spawns (e.g. when these tests are run via
 * `npm test`). Falls back to the well-known location of the npm CLI
 * bundled alongside the current Node.js installation (present on every
 * official Node.js distribution, on all three OSes), for the case where
 * tests are invoked directly via `node --test` rather than `npm test`.
 *
 * @returns {string|null} absolute path to npm-cli.js, or null if it
 *   could not be located (callers should skip rather than fail in that
 *   case, since this indicates an unusual environment, not a defect in
 *   the package under test).
 */
function resolveNpmCli() {
  const fromEnv = process.env.npm_execpath;
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }

  const execDir = path.dirname(process.execPath);
  const candidates = [
    // Typical POSIX layout: <node-root>/bin/node, npm under
    // <node-root>/lib/node_modules/npm/bin/npm-cli.js.
    path.join(path.dirname(execDir), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    // Typical Windows layout: <node-root>\node.exe, npm under
    // <node-root>\node_modules\npm\bin\npm-cli.js.
    path.join(execDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Run the resolved npm CLI via `node <npm-cli.js> ...args`, returning a
 * Promise that resolves once the child exits.
 *
 * This MUST be non-blocking (not `spawnSync`): these tests also run a
 * fake HTTP release server in this SAME Node.js process (see
 * test/helpers/server.js), and the npm child process's own postinstall
 * step makes an HTTP request back to that in-process server. A
 * synchronous spawn would block this process's event loop for the
 * entire lifetime of the child, so the in-process server could never
 * accept/respond to that callback request -- a guaranteed deadlock that
 * only resolves via timeout. Using async `spawn` keeps this process's
 * event loop free to service the fake server while the npm child runs.
 *
 * @param {string} npmCliPath from resolveNpmCli()
 * @param {string[]} args
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv}} [opts]
 * @returns {Promise<{status: number|null, signal: NodeJS.Signals|null, stdout: string, stderr: string}>}
 */
function runNpm(npmCliPath, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmCliPath, ...args], {
      cwd: opts.cwd,
      env: opts.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status, signal) => {
      resolve({ status, signal, stdout, stderr });
    });
  });
}

/**
 * Run a globally-installed shim executable. On POSIX this is a plain
 * executable/symlink and can be spawned directly. On Windows, npm
 * generates a `.cmd` wrapper for global bins, which (like any
 * `.cmd`/`.bat` file) cannot be spawned directly without `shell: true`
 * or explicit `cmd.exe /c` invocation. This helper is test-only; the
 * package's own production launcher (lib/launch.js) never ships or
 * needs this logic, since the real native holidaytw binary it spawns is
 * always a genuine platform executable, never a `.cmd`/`.bat` file.
 *
 * @param {string} shimPath
 * @param {string[]} args
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv}} [opts]
 * @returns {import('child_process').SpawnSyncReturns<string>}
 */
function runShim(shimPath, args, opts = {}) {
  const common = { cwd: opts.cwd, env: opts.env, encoding: 'utf8', windowsHide: true };
  if (process.platform === 'win32') {
    return spawnSync('cmd.exe', ['/d', '/s', '/c', shimPath, ...args], common);
  }
  return spawnSync(shimPath, args, common);
}

module.exports = { resolveNpmCli, runNpm, runShim };
