#!/bin/sh
# Functional test for install.sh: verifies the shipped program is named
# "holidaytw", the release archive naming/checksum verification still
# work, and that HOLIDAYTW_INSTALL_DIR / HOLIDAYBOOK_INSTALL_DIR /
# --dir precedence resolves deterministically. No network access is used;
# curl is stubbed to serve a locally built fake release archive. Scratch
# files live in a uniquely created mktemp directory under $TMPDIR (falling
# back to /tmp), never in a fixed repo-local path, and are removed on exit.
#
# Usage: sh scripts/test-install-sh.sh

set -eu

repo_root=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
work_root=$(mktemp -d "${TMPDIR:-/tmp}/holidaytw-install-test.XXXXXXXX") ||
  { echo "FAIL: cannot create a temporary work directory" >&2; exit 1; }
cleanup() {
  rm -rf "$work_root"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}
pass() {
  printf 'PASS: %s\n' "$*"
}

case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) fail "unsupported test host OS: $(uname -s)" ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch="amd64" ;;
  arm64|aarch64) arch="arm64" ;;
  *) fail "unsupported test host arch: $(uname -m)" ;;
esac

archive_name="holidaytw_${os}_${arch}.tar.gz"

# --- Build a fake release archive containing a stub "holidaytw" binary ---
assets_dir="${work_root}/assets"
payload_dir="${assets_dir}/payload"
mkdir -p "$payload_dir"
cat > "${payload_dir}/holidaytw" <<'EOF'
#!/bin/sh
echo "holidaytw stub $*"
EOF
chmod +x "${payload_dir}/holidaytw"
cp "${repo_root}/README.md" "${payload_dir}/README.md"
(cd "$payload_dir" && tar -czf "${assets_dir}/${archive_name}" holidaytw README.md)

if command -v shasum >/dev/null 2>&1; then
  archive_hash=$(shasum -a 256 "${assets_dir}/${archive_name}" | awk '{ print $1 }')
else
  archive_hash=$(sha256sum "${assets_dir}/${archive_name}" | awk '{ print $1 }')
fi
printf '%s  %s\n' "$archive_hash" "$archive_name" > "${assets_dir}/checksums.txt"

# --- Stub curl: install.sh only calls `curl ... --output DEST URL`. The
# stub ignores every flag except --output and serves files from
# STUB_ASSETS_DIR by basename, regardless of the (still validated)
# https://github.com/... URL requested. ---
stub_bin="${work_root}/bin"
mkdir -p "$stub_bin"
cat > "${stub_bin}/curl" <<'EOF'
#!/bin/sh
dest=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) dest="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
base=$(basename "$url")
cp "${STUB_ASSETS_DIR:?}/${base}" "$dest"
EOF
chmod +x "${stub_bin}/curl"

STUB_PATH="${stub_bin}:${PATH}"

run_install() {
  # run_install <install_dir_for_verification> [env assignments...] -- extra args...
  target_dir="$1"
  shift
  rm -rf "$target_dir"
  ( \
    export PATH="$STUB_PATH"; \
    export STUB_ASSETS_DIR="$assets_dir"; \
    "$@" \
  )
}

assert_binary() {
  dir="$1"
  label="$2"
  [ -x "${dir}/holidaytw" ] || fail "$label: ${dir}/holidaytw was not installed"
  [ ! -e "${dir}/holidaybook" ] || fail "$label: stale holidaybook binary present in ${dir}"
  output=$("${dir}/holidaytw" --version-stub-check 2>&1 || true)
  case "$output" in
    "holidaytw stub"*) : ;;
    *) fail "$label: installed binary did not behave as expected (got: $output)" ;;
  esac
  pass "$label installs holidaytw to ${dir}"
}

# --- Case 1: --dir flag takes precedence over both env vars ---
dir1="${work_root}/case1-dir-flag"
alt1="${work_root}/case1-should-not-be-used-tw"
alt2="${work_root}/case1-should-not-be-used-legacy"
run_install "$dir1" env \
  HOLIDAYTW_INSTALL_DIR="$alt1" \
  HOLIDAYBOOK_INSTALL_DIR="$alt2" \
  sh "${repo_root}/install.sh" --version v2.0.0 --dir "$dir1" >"${work_root}/case1.log" 2>&1 \
  || { cat "${work_root}/case1.log" >&2; fail "case1: install.sh exited non-zero"; }
assert_binary "$dir1" "case1 (--dir overrides env)"
[ ! -e "${alt1}/holidaytw" ] || fail "case1: HOLIDAYTW_INSTALL_DIR should have been overridden by --dir"
[ ! -e "${alt2}/holidaytw" ] || fail "case1: HOLIDAYBOOK_INSTALL_DIR should have been overridden by --dir"

# --- Case 2: HOLIDAYTW_INSTALL_DIR wins over legacy HOLIDAYBOOK_INSTALL_DIR ---
dir2="${work_root}/case2-holidaytw-env"
legacy2="${work_root}/case2-legacy-should-not-be-used"
run_install "$dir2" env \
  HOLIDAYTW_INSTALL_DIR="$dir2" \
  HOLIDAYBOOK_INSTALL_DIR="$legacy2" \
  sh "${repo_root}/install.sh" --version v2.0.0 >"${work_root}/case2.log" 2>&1 \
  || { cat "${work_root}/case2.log" >&2; fail "case2: install.sh exited non-zero"; }
assert_binary "$dir2" "case2 (HOLIDAYTW_INSTALL_DIR wins)"
[ ! -e "${legacy2}/holidaytw" ] || fail "case2: legacy HOLIDAYBOOK_INSTALL_DIR should not have been used"

# --- Case 3: legacy HOLIDAYBOOK_INSTALL_DIR alone still works (migration) ---
dir3="${work_root}/case3-legacy-only"
run_install "$dir3" env \
  HOLIDAYBOOK_INSTALL_DIR="$dir3" \
  sh "${repo_root}/install.sh" --version v2.0.0 >"${work_root}/case3.log" 2>&1 \
  || { cat "${work_root}/case3.log" >&2; fail "case3: install.sh exited non-zero"; }
assert_binary "$dir3" "case3 (legacy HOLIDAYBOOK_INSTALL_DIR alone)"

# --- Case 4: checksum mismatch is rejected ---
dir4="${work_root}/case4-bad-checksum"
mkdir -p "$dir4"
bad_assets="${work_root}/bad-assets"
mkdir -p "$bad_assets"
cp "${assets_dir}/${archive_name}" "${bad_assets}/${archive_name}"
printf '%s  %s\n' "0000000000000000000000000000000000000000000000000000000000000000" "$archive_name" > "${bad_assets}/checksums.txt"
if ( \
  export PATH="$STUB_PATH"; \
  export STUB_ASSETS_DIR="$bad_assets"; \
  sh "${repo_root}/install.sh" --version v2.0.0 --dir "$dir4" \
) >"${work_root}/case4.log" 2>&1; then
  cat "${work_root}/case4.log" >&2
  fail "case4: install.sh should reject a checksum mismatch"
fi
grep -q "checksum mismatch" "${work_root}/case4.log" || {
  cat "${work_root}/case4.log" >&2
  fail "case4: expected a checksum mismatch error message"
}
pass "case4 rejects checksum mismatch"

# --- Case 5: usage/help and error text reference holidaytw, not holidaybook ---
help_output=$(sh "${repo_root}/install.sh" --help)
case "$help_output" in
  *holidaytw*) : ;;
  *) fail "case5: --help output does not mention holidaytw" ;;
esac
case "$help_output" in
  *"HOLIDAYTW_INSTALL_DIR"*) : ;;
  *) fail "case5: --help output does not document HOLIDAYTW_INSTALL_DIR" ;;
esac
pass "case5 --help documents holidaytw and HOLIDAYTW_INSTALL_DIR"

echo "All install.sh functional tests passed."
