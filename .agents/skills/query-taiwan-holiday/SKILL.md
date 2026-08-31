---
name: query-taiwan-holiday
description: Query Taiwan holiday or workday status for a specific date. Automatically adapts to the caller's environment, falling through an already-installed `holidaytw`, the official install.sh/install.ps1, and finally the HTTPS static JSON API, reporting failure only once every trusted candidate has failed. Use for date-specific Taiwan holiday/workday questions, automation or scheduling checks, and any request for structured Taiwan holiday data.
---

# Query Taiwan Holiday

## Overview

Resolve whether a Taiwan date is a holiday or workday using the official `holidaytw` CLI when possible, automatically adapting to whatever tools are available in the current environment, and falling back to the static JSON API only when no trusted CLI install path works.

## 1. Validate the date

Require one exact ASCII ISO date (`YYYY-MM-DD`). Reject whitespace, timestamps, slashes, impossible dates (e.g. `2026-02-30`), and anything that does not round-trip through a calendar-aware date parser. Never proceed with an unvalidated or guessed date.

## 2. Resolve a way to query — try candidates in order, falling through on failure

Attempt each candidate that is applicable to the current environment, in order. If one fails (command not found, install error, network failure for that step), do not stop or give up — continue to the next candidate. Only after every applicable candidate below, including the static API fallback in step 4, has failed should you report retrieval failure.

1. **Already installed** — check `command -v holidaytw` (POSIX shells) or `Get-Command holidaytw` (PowerShell). If found, use it directly.
2. **npm / npx** — when Node.js 20 or newer and npm are available, run the officially published package without requiring a global install:

   ```sh
   npx --yes holidaytw --json YYYY-MM-DD
   ```

   The `holidaytw` npm package is the official cross-platform wrapper. Its postinstall or lazy installer downloads the matching native binary from the official GitHub Release and verifies `checksums.txt`. If npx is unavailable or this candidate fails, continue to the native installer candidates below.
3. **macOS/Linux** — install via the official one-liner, then re-resolve the path (step 5):

   ```sh
   curl -fsSL https://raw.githubusercontent.com/doggy8088/holidaybook/master/install.sh | sh
   ```
4. **Windows PowerShell** — install via the official one-liner, then re-resolve the path (step 5):

   ```powershell
   irm https://raw.githubusercontent.com/doggy8088/holidaybook/master/install.ps1 | iex
   ```
5. **Resolve the installed path** — after install.sh/install.ps1 finishes, `holidaytw` is not guaranteed to be on `PATH` yet in the current shell. Re-check `PATH` first; if still not found, use the known default install locations: `~/.local/bin/holidaytw` (or the directory passed via `--dir`) on macOS/Linux, `%LOCALAPPDATA%\Programs\holidaytw\holidaytw.exe` (or the `-InstallDir` used) on Windows. Invoke the resolved full path directly instead of re-running the installer.
6. **All install/CLI candidates failed or are unsupported here** (no network access to npm or GitHub, restricted or sandboxed shell, unsupported OS/architecture, permission errors) — use the HTTPS static JSON API fallback (step 4 below) instead of retrying a failed install.

A failed candidate never by itself means the query failed — it only means try the next candidate, which may still return valid data (including the API fallback). Use only official sources: the `holidaytw` package on `registry.npmjs.org`, `github.com/doggy8088/holidaybook`, `raw.githubusercontent.com/doggy8088/holidaybook`, and `https://holiday.gh.miniasp.com`. Never use a third-party mirror or proxy for install or data, and never disable TLS verification.

## 4. Query

- CLI: `holidaytw --json YYYY-MM-DD` (human-readable: `holidaytw YYYY-MM-DD`). Add `--base-url https://mirror.example` only if a trusted mirror is explicitly required.
- Static JSON fallback (use only when no CLI could be run or installed):

  ```sh
  curl --fail-with-body --silent --show-error --location \
    --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 30 \
    'https://holiday.gh.miniasp.com/YYYY-MM-DD.json'
  ```

  Substitute only the already-validated date; keep the URL quoted.
- Parse JSON strictly: require one object, a matching `date` (the API may use `YYYYMMDD`), and a present, recognized `isHoliday` value. Never scrape human-readable text output.

## 5. Interpret

- Treat `isHoliday: true` or `1` as a holiday; `isHoliday: false` or `0` as a workday.
- Never infer status from weekday/weekend alone; Taiwan designates weekend workdays (`補行上班日`) and compensatory holidays.
- The two sources use different field shapes for the same data:
  - `holidaytw --json`: `date` is `YYYY-MM-DD`, `isHoliday` is a boolean, category field is `category`.
  - Static JSON (`https://holiday.gh.miniasp.com/YYYY-MM-DD.json`): `date` is `YYYYMMDD`, `isHoliday` is `0`/`1`, category field is `holidaycategory`.
- Preserve `date`, `name`, the category field for that source, and `description`. Workdays can carry them too (e.g. 軍人節 is `isHoliday` false with a `name` and `description`). For automation, return the raw/requested JSON shape instead of prose unless asked.
- Treat missing, null, or unrecognized `isHoliday` as unknown data — never as a workday.

## 6. Handle failures

- A nonzero exit from any single trusted candidate (CLI, an installer script, or one `curl` attempt) is not, by itself, a reason to report failure — fall through to the next candidate as described in step 2. Only report retrieval failure and make no holiday-status claim once every applicable candidate, including the static API fallback, has failed.
- CLI exit codes: `0` success, `2` bad arguments or invalid date, `1` runtime failure. With `--json`, failures print `{"error":{"code":"...","message":"..."}}` on stderr, where `code` is one of `usage`, `invalid_date`, `invalid_configuration`, `http_error`, `invalid_response`, `timeout`, `canceled`, `network_error`, `output_error`.
- Distinguish HTTP 404 or unavailable data from DNS, TLS, timeout, and other transport errors when that detail is available.
- Reject malformed JSON, non-object responses, date mismatches, and missing required fields explicitly. Never silently substitute a nearby date or guess from the calendar.

Note: this is the canonical, environment-adaptive version of this skill. If a repository-scoped copy of `query-taiwan-holiday` is also discoverable, it describes the same query/interpret/failure-handling behavior; prefer whichever copy the host surfaces.
