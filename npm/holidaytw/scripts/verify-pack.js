#!/usr/bin/env node
'use strict';

// Sanity-checks the exact contents of the published npm tarball: that it
// contains only the intended files (no tests, fixtures, native binaries,
// staging/lock directories, or VCS metadata) and that the single
// "holidaytw" bin entry point is present and marked executable in the
// tarball.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const packageRoot = path.resolve(__dirname, '..');
const pkg = require(path.join(packageRoot, 'package.json'));

function fail(message) {
  console.error(`pack:check FAILED: ${message}`);
  process.exitCode = 1;
}

function resolveNpmCli() {
  if (process.env.npm_execpath && fs.existsSync(process.env.npm_execpath)) {
    return process.env.npm_execpath;
  }

  const execDir = path.dirname(process.execPath);
  const candidates = [
    path.join(path.dirname(execDir), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(execDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function main() {
  const workDir = fs.mkdtempSync(path.join(packageRoot, '.pack-check-'));
  let tarballName;

  let packOutput;
  try {
    const npmCli = resolveNpmCli();
    if (!npmCli) {
      throw new Error('could not locate npm-cli.js for the current Node.js installation');
    }
    packOutput = execFileSync(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', workDir], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
  } catch (err) {
    fail(`"npm pack" failed: ${err.message}`);
    cleanup(workDir);
    return;
  }

  let packInfo;
  try {
    packInfo = JSON.parse(packOutput)[0];
  } catch (err) {
    fail(`Could not parse "npm pack --json" output: ${err.message}`);
    cleanup(workDir);
    return;
  }

  tarballName = packInfo.filename;
  const tarballPath = path.join(workDir, tarballName);
  if (!fs.existsSync(tarballPath)) {
    fail(`Expected tarball not found at ${tarballPath}`);
    cleanup(workDir);
    return;
  }

  const listing = execFileSync('tar', ['-tvf', tarballPath], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);

  const entries = listing.map((line) => {
    const parts = line.trim().split(/\s+/);
    const mode = parts[0];
    const name = parts[parts.length - 1].replace(/^package\//, '');
    return { mode, name };
  });

  const names = entries.map((e) => e.name).filter((n) => n !== '' && n !== '.');

  const disallowedPrefixes = ['test/', 'native/', '.git', '.staging-', 'node_modules/'];
  const disallowed = names.filter((n) => disallowedPrefixes.some((p) => n === p.replace(/\/$/, '') || n.startsWith(p)));
  if (disallowed.length > 0) {
    fail(`Tarball contains disallowed paths: ${disallowed.join(', ')}`);
  }

  const requiredFiles = ['package.json', 'README.md', 'bin/holidaytw.js', 'scripts/postinstall.js'];
  for (const req of requiredFiles) {
    if (!names.includes(req)) {
      fail(`Tarball is missing required file: ${req}`);
    }
  }

  const libFiles = names.filter((n) => n.startsWith('lib/') && n.endsWith('.js'));
  if (libFiles.length < 5) {
    fail(`Expected several lib/*.js modules in tarball, found: ${libFiles.join(', ') || '(none)'}`);
  }

  const binEntries = pkg.bin || {};
  const binNames = Object.keys(binEntries);
  if (binNames.length !== 1 || binNames[0] !== 'holidaytw') {
    fail(`package.json "bin" must define exactly one entry, "holidaytw", found: ${binNames.join(', ')}`);
  }

  const binLauncherEntry = entries.find((e) => e.name === 'bin/holidaytw.js');
  if (!binLauncherEntry) {
    fail('bin/holidaytw.js entry not found in tarball listing');
  } else if (!/^-rwx/.test(binLauncherEntry.mode)) {
    fail(`bin/holidaytw.js is not marked executable in the tarball (mode: ${binLauncherEntry.mode})`);
  }

  const launcherSrc = fs.readFileSync(path.join(packageRoot, 'bin/holidaytw.js'), 'utf8');
  if (!launcherSrc.startsWith('#!/usr/bin/env node')) {
    fail('bin/holidaytw.js must start with a "#!/usr/bin/env node" shebang');
  }

  if (pkg.license !== 'UNLICENSED') {
    fail(`Expected package.json license to be "UNLICENSED", found: ${pkg.license}`);
  }

  const expectedRepoUrl = 'https://github.com/doggy8088/holidaybook.git';
  if (!pkg.repository || pkg.repository.url !== expectedRepoUrl) {
    fail(`package.json repository.url must be exactly ${JSON.stringify(expectedRepoUrl)}, found: ${JSON.stringify(pkg.repository && pkg.repository.url)}`);
  }

  cleanup(workDir);

  if (process.exitCode) {
    console.error('pack:check: one or more checks failed (see above).');
  } else {
    console.log(`pack:check: OK (${names.length} files, tarball ${packInfo.size} bytes / unpacked ${packInfo.unpackedSize} bytes).`);
  }
}

function cleanup(workDir) {
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

main();
