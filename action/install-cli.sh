#!/usr/bin/env bash
# Install the tested CLI so `tested` is on PATH for later Action steps.
#
# Env (set by action.yml):
#   CLI_PATH         local checkout (wins)
#   CLI_REF          optional git ref — fallback clone
#   CLI_REPOSITORY   owner/name for git fallback (default tested-hq/cli)
#   CLI_VERSION      npm version (default 0.1.7)
#   ACTION_PATH      github.action_path (clone dest + bin shim)
#
# Priority: cli-path > cli-ref (if set) > npm @tested/cli@$CLI_VERSION
#
# --plan   print source + spec and exit 0 (no install)
set -euo pipefail

PKG='@tested/cli'
REPO_DEFAULT='tested-hq/cli'
VERSION_DEFAULT='0.1.7'

SAFE_VERSION_RE='^[A-Za-z0-9._~+^-]{1,64}$'
SAFE_REPO_RE='^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
SAFE_REF_RE='^[A-Za-z0-9_./@~^-]{1,256}$'

CLI_PATH="${CLI_PATH:-}"
CLI_REF="${CLI_REF:-}"
CLI_REPOSITORY="${CLI_REPOSITORY:-$REPO_DEFAULT}"
CLI_VERSION="${CLI_VERSION:-$VERSION_DEFAULT}"
ACTION_PATH="${ACTION_PATH:-}"

if [ -z "$CLI_VERSION" ]; then
  CLI_VERSION="$VERSION_DEFAULT"
fi

resolve_source() {
  if [ -n "$CLI_PATH" ]; then
    printf '%s\n' path
  elif [ -n "$CLI_REF" ]; then
    printf '%s\n' git
  else
    printf '%s\n' npm
  fi
}

write_output() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf '%s\n' "$1" >> "$GITHUB_OUTPUT"
  fi
}

add_path() {
  if [ -n "${GITHUB_PATH:-}" ]; then
    printf '%s\n' "$1" >> "$GITHUB_PATH"
  fi
  export PATH="$1:$PATH"
}

validate_npm() {
  if ! [[ "$CLI_VERSION" =~ $SAFE_VERSION_RE ]]; then
    echo "error: unsafe npm version '${CLI_VERSION}'" >&2
    return 1
  fi
}

validate_git() {
  if ! [[ "$CLI_REPOSITORY" =~ $SAFE_REPO_RE ]]; then
    echo "error: unsafe cli-repository '${CLI_REPOSITORY}'" >&2
    return 1
  fi
  if ! [[ "$CLI_REF" =~ $SAFE_REF_RE ]] || [[ "$CLI_REF" == -* ]]; then
    echo "error: unsafe cli-ref '${CLI_REF}'" >&2
    return 1
  fi
}

print_plan() {
  local source
  source="$(resolve_source)"
  echo "source=${source}"
  case "$source" in
    path)
      echo "dir=${CLI_PATH}"
      ;;
    git)
      validate_git
      echo "repository=${CLI_REPOSITORY}"
      echo "ref=${CLI_REF}"
      ;;
    npm)
      validate_npm
      echo "spec=${PKG}@${CLI_VERSION}"
      ;;
  esac
}

put_tested_on_path() {
  local tested_js="$1"
  if [ ! -f "$tested_js" ]; then
    echo "error: missing ${tested_js}" >&2
    return 1
  fi
  # cli-path=. yields ./dist/tested.js. A symlink of that relative path
  # from $ACTION_PATH/.bin points at .bin/dist/tested.js (missing).
  tested_js="$(cd "$(dirname "$tested_js")" && pwd)/$(basename "$tested_js")"
  chmod +x "$tested_js" || true
  local bin_dir
  if [ -n "$ACTION_PATH" ]; then
    bin_dir="${ACTION_PATH}/.bin"
  else
    bin_dir="$(dirname "$tested_js")/.bin"
  fi
  mkdir -p "$bin_dir"
  # Wrapper, not a symlink: tsup output may lack a shebang, and the
  # target must stay valid when cwd is the consumer repo.
  printf '#!/usr/bin/env bash\nexec node %q "$@"\n' "$tested_js" > "${bin_dir}/tested"
  chmod +x "${bin_dir}/tested"
  add_path "$bin_dir"
  if ! command -v tested >/dev/null 2>&1; then
    echo "error: tested not on PATH after linking ${tested_js}" >&2
    return 1
  fi
}

build_from_dir() {
  local dir="$1"
  local abs
  abs="$(cd "$dir" && pwd)"
  (
    cd "$abs"
    if ! command -v pnpm >/dev/null 2>&1; then
      corepack enable
      corepack prepare pnpm@11.3.0 --activate
    fi
    pnpm install --frozen-lockfile || pnpm install
    pnpm build
    test -f dist/tested.js
  )
  put_tested_on_path "${abs}/dist/tested.js"
}

clone_cli() {
  local dest="$1"
  rm -rf "$dest"
  if git clone --depth 1 --branch "$CLI_REF" "https://github.com/${CLI_REPOSITORY}.git" "$dest" 2>/dev/null; then
    return 0
  fi
  git clone --filter=blob:none --no-checkout "https://github.com/${CLI_REPOSITORY}.git" "$dest"
  git -C "$dest" fetch --depth 1 origin "$CLI_REF"
  git -C "$dest" checkout FETCH_HEAD
}

if [ "${1:-}" = "--plan" ]; then
  print_plan
  exit 0
fi

if [ "${1:-}" = "--link" ]; then
  if [ -z "${2:-}" ]; then
    echo "error: --link requires a path to tested.js" >&2
    exit 1
  fi
  put_tested_on_path "$2"
  exit 0
fi

source="$(resolve_source)"
case "$source" in
  path)
    if [ ! -d "$CLI_PATH" ]; then
      echo "cli-path does not exist: ${CLI_PATH}" >&2
      exit 1
    fi
    build_from_dir "$CLI_PATH"
    write_output "source=path"
    write_output "dir=${CLI_PATH}"
    echo "Installed tested CLI from path ${CLI_PATH}"
    ;;
  git)
    validate_git
    if [ -z "$ACTION_PATH" ]; then
      echo "error: ACTION_PATH is required for git install" >&2
      exit 1
    fi
    dest="${ACTION_PATH}/.cli-src"
    clone_cli "$dest"
    build_from_dir "$dest"
    write_output "source=git"
    write_output "dir=${dest}"
    echo "Installed tested CLI from git ${CLI_REPOSITORY}@${CLI_REF}"
    ;;
  npm)
    validate_npm
    npm install -g "${PKG}@${CLI_VERSION}"
    npm_bin="$(npm prefix -g)/bin"
    add_path "$npm_bin"
    if ! command -v tested >/dev/null 2>&1; then
      echo "error: tested not on PATH after npm install -g ${PKG}@${CLI_VERSION}" >&2
      exit 1
    fi
    write_output "source=npm"
    write_output "spec=${PKG}@${CLI_VERSION}"
    echo "Installed tested CLI from npm ${PKG}@${CLI_VERSION}"
    ;;
esac
