---
name: query-taiwan-holiday
description: Query Taiwan holiday or workday status for a specific date. Use for date-specific holiday questions, automation or scheduling checks, and requests for structured Taiwan holiday data.
---

# Query Taiwan Holiday

## Query

1. Require one exact ASCII ISO date (`YYYY-MM-DD`). Reject whitespace, timestamps, slashes, impossible dates, and values that do not round-trip through a calendar-aware date parser.
2. Prefer the installed CLI for structured output:

   ```sh
   holidaybook --json YYYY-MM-DD
   ```

   Use `holidaybook YYYY-MM-DD` for a concise human-readable answer. Add `--base-url https://mirror.example` to either form when a trusted mirror is required.
3. If `holidaybook` is unavailable, request the validated date directly:

   ```sh
   curl --fail-with-body --silent --show-error --location \
     --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 30 \
     'https://holiday.gh.miniasp.com/YYYY-MM-DD.json'
   ```

   Substitute only the already validated date; keep the URL quoted. Do not disable TLS verification.
4. Parse JSON rather than scraping text. Require one object, a matching `date` (the API may use `YYYYMMDD`), and a present, recognized `isHoliday` value.

## Interpret

- Treat `isHoliday: true` or `1` as a holiday.
- Treat `isHoliday: false` or `0` as a workday.
- Do not infer status from weekday/weekend alone; Taiwan can designate weekend workdays (`補行上班日`) and compensatory holidays.
- The two sources use different field shapes for the same data:
  - `holidaybook --json`: `date` is `YYYY-MM-DD`, `isHoliday` is a boolean, and the category field is `category`.
  - Static JSON (`https://holiday.gh.miniasp.com/YYYY-MM-DD.json`): `date` is `YYYYMMDD`, `isHoliday` is `0`/`1`, and the category field is `holidaycategory`.
- Preserve useful structured fields: `date`, `name`, the category field for that source, and `description`. Workdays can also carry them (for example 軍人節 is `isHoliday` false with a name and description). For automation, return the raw or requested JSON shape instead of prose unless asked.
- Treat missing, null, or unrecognized `isHoliday` as unknown data, never as a workday.

## Handle failures

- On a nonzero CLI or curl exit, report retrieval failure and make no holiday-status claim.
- CLI exit codes: `0` success, `2` bad arguments or invalid date, `1` runtime failure. With `--json`, failures print `{"error":{"code":"...","message":"..."}}` on stderr, where `code` is one of `usage`, `invalid_date`, `invalid_configuration`, `http_error`, `invalid_response`, `timeout`, `canceled`, `network_error`, `output_error`.
- Distinguish HTTP 404 or unavailable data from DNS, TLS, timeout, and other transport errors when stderr provides that detail.
- Reject malformed JSON, non-object responses, date mismatches, and missing required fields explicitly.
- Never silently substitute a nearby date or guess from the calendar.
