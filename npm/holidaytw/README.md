# holidaytw

A tiny npm launcher for the `holidaytw` native CLI, which answers "is this
a holiday in Taiwan?" using data from the
[Taipei City Open Data Platform](https://data.taipei/dataset/detail?id=c30ca421-d935-4faa-b523-9c175c8de738).
`holidaytw` is built from the [`doggy8088/holidaybook`](https://github.com/doggy8088/holidaybook)
repository.

This package has **zero runtime dependencies**. It does not reimplement the
CLI in JavaScript; instead, on install (or on first run) it downloads the
real prebuilt `holidaytw` binary for your platform from the project's
[GitHub Releases](https://github.com/doggy8088/holidaybook/releases), and
every invocation simply forwards to that native binary.

> **Note:** this document describes how the package is designed to be
> installed and used once it has been published to the npm registry. It
> does not itself assert that a specific version is currently live on
> npm — check https://www.npmjs.com/package/holidaytw for the actual
> published state.

## Install

```sh
npm install -g holidaytw
```

Or run it once without installing:

```sh
npx holidaytw --help
```

Once installed, the command is:

```sh
holidaytw --help
```

## Supported platforms

Prebuilt native binaries are fetched for these six targets (Node's
`process.platform`-`process.arch` pairs):

| Platform     | Release asset                     |
| ------------ | ---------------------------------- |
| darwin-x64   | `holidaytw_darwin_amd64.tar.gz`    |
| darwin-arm64 | `holidaytw_darwin_arm64.tar.gz`    |
| linux-x64    | `holidaytw_linux_amd64.tar.gz`     |
| linux-arm64  | `holidaytw_linux_arm64.tar.gz`     |
| win32-x64    | `holidaytw_windows_amd64.zip`      |
| win32-arm64  | `holidaytw_windows_arm64.zip`      |

Requires Node.js **>= 20**. Any other platform/arch combination produces
an explicit error message and a non-zero exit code — there is no silent
fallback.

## How installation works

1. **`postinstall`** (runs automatically during `npm install`) downloads
   and installs the matching native binary right away, and this is a
   **required** step: if it fails for any reason (network problem,
   checksum mismatch, unsupported platform, etc.), `npm install` itself
   fails with a non-zero exit code and a clear, actionable error message.
   There is no silent "successful install with a missing/corrupt binary"
   outcome.
2. Every download fetches both the release archive **and** the release's
   `checksums.txt` from the same GitHub Release, and verifies the
   archive's SHA-256 against the exact `checksums.txt` entry before doing
   anything else with it.
3. The archive is extracted **without any third-party dependency** — a
   small built-in parser reads the gzip/tar or ZIP central-directory
   structure directly, validates sizes/compression method/CRC (ZIP) or
   tar header checksums, and rejects path traversal, absolute paths,
   symlinks/hardlinks, unsupported entry types, duplicate entries, and
   oversized entries. Only the expected single binary is ever extracted.
4. The extracted binary is executed with `--version` and its output is
   checked to confirm it is exactly the expected native `holidaytw`
   binary (not merely that it exits successfully) *before* it is moved
   into place, and it is installed with an atomic rename so a crash or
   concurrent install can never leave a partial/corrupt binary behind. If
   the installed copy somehow fails this same check immediately after
   the rename, it is deleted again so no invalid binary is left in place.
   A directory-based lock coordinates concurrent installs across
   processes.
5. The launcher forwards all CLI arguments, stdio, the exit code, and
   termination signals (e.g. `SIGINT`/`SIGTERM`) to the native binary as
   faithfully as Node allows.

**Lazy install fallback:** the launcher (not postinstall) performs the
same fully-verified install on demand, the first time you actually run
`holidaytw`, but only in the two cases where postinstall never got a
chance to install a working binary at all: you installed with
`npm install --ignore-scripts` (which skips postinstall entirely), or a
previously-installed binary was later removed from outside this
package's control (the launcher only checks that a file exists at the
expected path; it does not detect or repair a binary that is present but
corrupted). This lazy path uses the exact same download + checksum +
extraction + `--version` verification pipeline as postinstall — it is
not a weaker or unverified fallback. If the lazy install also fails, the
CLI exits non-zero with the same actionable error.

## Native binary version vs. npm package version

The npm package's own `version` field (this package's semver, e.g.
`2.0.0`) is intentionally **decoupled** from the native `holidaytw`
GitHub release tag it downloads. The native release tag is tracked
separately in this package's `package.json` under
`holidaytw.nativeVersion`. This means the npm package version can be
bumped (including publishing a temporary prerelease such as
`2.0.0-bootstrap.0`) without needing to change, or being constrained by,
the native release tag being fetched (e.g. `v2.0.0`).

## Source and releases

- Source repository: https://github.com/doggy8088/holidaybook
- Native binary releases: https://github.com/doggy8088/holidaybook/releases

## License

`UNLICENSED` — the source repository does not currently publish an open
source license, so this package intentionally does not claim MIT or any
other license grant.
