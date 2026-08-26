---
name: query-taiwan-holiday
description: Query Taiwan holiday or workday status for a specific date. Automatically adapts to the caller's environment, falling through an already-installed `holidaytw`, the official install.sh/install.ps1, and finally the HTTPS static JSON API, reporting failure only once every trusted candidate has failed. Use for date-specific holiday questions, automation or scheduling checks, and requests for structured Taiwan holiday data.
---

# Query Taiwan Holiday

> This is a concise, repository-scoped copy. The canonical, fully detailed version of this
> skill lives at the repository root: [`skill/SKILL.md`](../../../skill/SKILL.md). Both
> describe the same query/interpret/failure-handling behavior; prefer whichever copy the
> host surfaces.

## Query

1. Require one exact ASCII ISO date (`YYYY-MM-DD`). Reject whitespace, timestamps, slashes, impossible dates, and values that do not round-trip through a calendar-aware date parser.
2. Try trusted candidates in order, falling through to the next on failure rather than stopping: (a) an already-installed `holidaytw` on `PATH`; (b) the official `install.sh` one-liner on macOS/Linux or `install.ps1` on Windows PowerShell, then re-resolving the installed path (`PATH`, or the default/`--dir`/`-InstallDir` location) if it is not yet on `PATH`. A failed candidate is not a final failure — it only means try the next one, which (including the API fallback below) may still return valid data. Only use official sources: `github.com/doggy8088/holidaybook` and `raw.githubusercontent.com/doggy8088/holidaybook`. Until this skill is updated after the official npm package has been published and its ownership is established, do not execute `npx holidaytw` or `npm install holidaytw`; the unclaimed registry name is not yet a trusted source.
3. Query with the resolved CLI for structured output:

   ```sh
   holidaytw --json YYYY-MM-DD
   ```

   Use `holidaytw YYYY-MM-DD` for a concise human-readable answer. Add `--base-url https://mirror.example` to either form when a trusted mirror is required.
4. If every candidate in step 2 failed or is unsupported here (no network, unsupported OS/arch, sandboxed shell, permission errors), fall back to the validated date against the static API:

   ```sh
   curl --fail-with-body --silent --show-error --location \
     --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 30 \
     'https://holiday.gh.miniasp.com/YYYY-MM-DD.json'
   ```

   Substitute only the already validated date; keep the URL quoted. Do not disable TLS verification.
5. Parse JSON rather than scraping text. Require one object, a matching `date` (the API may use `YYYYMMDD`), and a present, recognized `isHoliday` value.

## Interpret

- Treat `isHoliday: true` or `1` as a holiday.
- Treat `isHoliday: false` or `0` as a workday.
- Do not infer status from weekday/weekend alone; Taiwan can designate weekend workdays (`補行上班日`) and compensatory holidays.
- The two sources use different field shapes for the same data:
  - `holidaytw --json`: `date` is `YYYY-MM-DD`, `isHoliday` is a boolean, and the category field is `category`.
  - Static JSON (`https://holiday.gh.miniasp.com/YYYY-MM-DD.json`): `date` is `YYYYMMDD`, `isHoliday` is `0`/`1`, and the category field is `holidaycategory`.
- Preserve useful structured fields: `date`, `name`, the category field for that source, and `description`. Workdays can also carry them (for example 軍人節 is `isHoliday` false with a name and description). For automation, return the raw or requested JSON shape instead of prose unless asked.
- Treat missing, null, or unrecognized `isHoliday` as unknown data, never as a workday.

## Handle failures

- A nonzero exit from any single trusted candidate (CLI, an installer script, or one `curl` attempt) is not, by itself, a reason to report failure — fall through to the next candidate per step 2. Only report retrieval failure and make no holiday-status claim once every candidate, including the static API fallback, has failed.
- CLI exit codes: `0` success, `2` bad arguments or invalid date, `1` runtime failure. With `--json`, failures print `{"error":{"code":"...","message":"..."}}` on stderr, where `code` is one of `usage`, `invalid_date`, `invalid_configuration`, `http_error`, `invalid_response`, `timeout`, `canceled`, `network_error`, `output_error`.
- Distinguish HTTP 404 or unavailable data from DNS, TLS, timeout, and other transport errors when stderr provides that detail.
- Reject malformed JSON, non-object responses, date mismatches, and missing required fields explicitly.
- Never silently substitute a nearby date or guess from the calendar.
