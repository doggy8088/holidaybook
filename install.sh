#!/bin/sh

set -eu

REPOSITORY="doggy8088/holidaybook"
PROGRAM="holidaybook"
version="latest"
install_dir="${HOLIDAYBOOK_INSTALL_DIR:-}"

usage() {
  cat <<'EOF'
Install holidaybook from GitHub Releases.

Usage:
  install.sh [--version VERSION] [--dir DIRECTORY]

Options:
  -v, --version VERSION  Release tag to install (default: latest)
  -d, --dir DIRECTORY    Installation directory (default: ~/.local/bin)
  -h, --help             Show this help
EOF
}

die() {
  printf 'holidaybook installer: %s\n' "$*" >&2
  exit 1
}

if [ -z "$install_dir" ] && [ -n "${HOME:-}" ]; then
  install_dir="${HOME}/.local/bin"
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    -v|--version)
      [ "$#" -ge 2 ] || die "$1 requires a value"
      version="$2"
      shift 2
      ;;
    --version=*)
      version=${1#*=}
      shift
      ;;
    -d|--dir)
      [ "$#" -ge 2 ] || die "$1 requires a value"
      install_dir="$2"
      shift 2
      ;;
    --dir=*)
      install_dir=${1#*=}
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1 (try --help)"
      ;;
  esac
done

[ -n "$version" ] || die "version cannot be empty"
[ -n "$install_dir" ] ||
  die "installation directory cannot be empty; use --dir when HOME is not set"

case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) die "unsupported operating system: $(uname -s); use macOS or Linux" ;;
esac

case "$(uname -m)" in
  x86_64|amd64) arch="amd64" ;;
  arm64|aarch64) arch="arm64" ;;
  *) die "unsupported architecture: $(uname -m); use amd64 or arm64" ;;
esac

archive="${PROGRAM}_${os}_${arch}.tar.gz"
if [ "$version" = "latest" ]; then
  release_url="https://github.com/${REPOSITORY}/releases/latest/download"
else
  case "$version" in
    v*) tag="$version" ;;
    *) tag="v$version" ;;
  esac
  release_url="https://github.com/${REPOSITORY}/releases/download/${tag}"
fi

mkdir -p "$install_dir" ||
  die "cannot create $install_dir; choose a writable directory with --dir"
work_dir="${install_dir}/.${PROGRAM}-install.$$"
staged_binary=""
umask 077
mkdir "$work_dir" || die "cannot create temporary directory in $install_dir"

cleanup() {
  if [ -n "$staged_binary" ]; then
    rm -f "$staged_binary"
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

download() {
  url="$1"
  destination="$2"
  case "$url" in
    https://github.com/*) ;;
    *) die "refusing non-GitHub or non-HTTPS download URL: $url" ;;
  esac

  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --silent --show-error \
      --proto '=https' --tlsv1.2 --output "$destination" "$url" ||
      die "download failed: $url"
  elif command -v wget >/dev/null 2>&1; then
    wget --quiet --https-only --output-document="$destination" "$url" ||
      die "download failed: $url"
  else
    die "curl or wget is required to download the release"
  fi
}

printf 'Downloading %s (%s/%s)...\n' "$PROGRAM" "$os" "$arch"
download "${release_url}/${archive}" "${work_dir}/${archive}"
download "${release_url}/checksums.txt" "${work_dir}/checksums.txt"

expected_hash=$(
  awk -v file="$archive" \
    '$2 == file || $2 == "*" file { print tolower($1); exit }' \
    "${work_dir}/checksums.txt"
)
[ -n "$expected_hash" ] ||
  die "checksums.txt does not contain an entry for $archive"

if command -v sha256sum >/dev/null 2>&1; then
  actual_hash=$(sha256sum "${work_dir}/${archive}" | awk '{ print tolower($1) }')
elif command -v shasum >/dev/null 2>&1; then
  actual_hash=$(shasum -a 256 "${work_dir}/${archive}" | awk '{ print tolower($1) }')
elif command -v openssl >/dev/null 2>&1; then
  actual_hash=$(openssl dgst -sha256 "${work_dir}/${archive}" | awk '{ print tolower($NF) }')
else
  die "sha256sum, shasum, or openssl is required to verify $archive"
fi

if [ "$actual_hash" != "$expected_hash" ]; then
  die "checksum mismatch for $archive; the downloaded file was not installed"
fi

command -v tar >/dev/null 2>&1 || die "tar is required to extract $archive"
mkdir "${work_dir}/extract"
tar -xzf "${work_dir}/${archive}" -C "${work_dir}/extract" ||
  die "could not extract $archive"

source_binary="${work_dir}/extract/${PROGRAM}"
[ -f "$source_binary" ] ||
  die "release archive did not contain the $PROGRAM binary"

staged_binary="${install_dir}/.${PROGRAM}.new.$$"
cp "$source_binary" "$staged_binary" ||
  die "cannot stage the binary in $install_dir"
chmod 755 "$staged_binary" ||
  die "cannot make the staged binary executable"
mv -f "$staged_binary" "${install_dir}/${PROGRAM}" ||
  die "cannot install to ${install_dir}/${PROGRAM}; check permissions"
staged_binary=""

printf 'Installed %s to %s\n' "$PROGRAM" "${install_dir}/${PROGRAM}"
case ":${PATH:-}:" in
  *":${install_dir}:"*)
    printf 'Next: %s --help\n' "$PROGRAM"
    ;;
  *)
    printf 'Next: add %s to PATH, then run: %s --help\n' "$install_dir" "$PROGRAM"
    ;;
esac
