#!/usr/bin/env bash
# Resolve a git base for `tested check` / `tested push` on a shallow
# GitHub Actions checkout.
#
# Env (set by action.yml):
#   INPUT_BASE       optional action input (wins)
#   EVENT_NAME       github.event_name
#   PR_BASE_SHA      github.event.pull_request.base.sha
#   PR_BASE_REF      github.event.pull_request.base.ref  (or github.base_ref)
#   PUSH_BEFORE      github.event.before
#   DEFAULT_BRANCH   github.event.repository.default_branch
#
# Prints the resolved ref to stdout. Fetches it when missing.
# Does not require fetch-depth: 0.
set -euo pipefail

SAFE_REF_RE='^[A-Za-z0-9_./@~^-]{1,256}$'

is_zero_sha() {
  [[ "${1:-}" =~ ^0+$ ]]
}

is_safe_ref() {
  local ref="${1:-}"
  [[ -n "$ref" ]] || return 1
  [[ "$ref" != -* ]] || return 1
  [[ "$ref" =~ $SAFE_REF_RE ]]
}

ref_exists() {
  git rev-parse --verify --quiet "${1}^{commit}" >/dev/null 2>&1
}

fetch_ref() {
  local ref="$1"
  local spec="$ref"
  if [[ "$ref" == origin/* ]]; then
    spec="${ref#origin/}"
  fi
  echo "Fetching missing base ref: $spec" >&2
  git fetch --depth=1 origin "$spec"
}

ensure_fetched() {
  local ref="$1"
  if [ "$ref" = "HEAD" ] || ref_exists "$ref"; then
    return 0
  fi
  fetch_ref "$ref"
  if ref_exists "$ref"; then
    return 0
  fi
  # Branch fetch lands on origin/<name> or FETCH_HEAD.
  if [[ "$ref" != origin/* ]] && ref_exists "origin/${ref}"; then
    return 0
  fi
  if ref_exists FETCH_HEAD; then
    return 0
  fi
  echo "error: could not fetch git base '$ref' (shallow checkout; origin missing that ref)" >&2
  return 1
}

resolved_after_fetch() {
  local ref="$1"
  if ref_exists "$ref"; then
    printf '%s\n' "$ref"
    return 0
  fi
  if [[ "$ref" != origin/* ]] && ref_exists "origin/${ref}"; then
    printf '%s\n' "origin/${ref}"
    return 0
  fi
  if ref_exists FETCH_HEAD; then
    git rev-parse --verify FETCH_HEAD
    return 0
  fi
  echo "error: git base '$ref' is not in the working tree" >&2
  return 1
}

resolve_base() {
  if [ -n "${INPUT_BASE:-}" ]; then
    if ! is_safe_ref "$INPUT_BASE"; then
      echo "error: unsafe git base '${INPUT_BASE}'" >&2
      return 1
    fi
    printf '%s\n' "$INPUT_BASE"
    return 0
  fi

  case "${EVENT_NAME:-}" in
    pull_request | pull_request_target)
      if [ -n "${PR_BASE_SHA:-}" ] && ! is_zero_sha "$PR_BASE_SHA"; then
        if ! is_safe_ref "$PR_BASE_SHA"; then
          echo "error: unsafe PR base sha" >&2
          return 1
        fi
        printf '%s\n' "$PR_BASE_SHA"
        return 0
      fi
      if [ -n "${PR_BASE_REF:-}" ]; then
        if ! is_safe_ref "$PR_BASE_REF"; then
          echo "error: unsafe PR base ref" >&2
          return 1
        fi
        printf '%s\n' "$PR_BASE_REF"
        return 0
      fi
      ;;
    push)
      if [ -n "${PUSH_BEFORE:-}" ] && ! is_zero_sha "$PUSH_BEFORE"; then
        if ! is_safe_ref "$PUSH_BEFORE"; then
          echo "error: unsafe push before sha" >&2
          return 1
        fi
        printf '%s\n' "$PUSH_BEFORE"
        return 0
      fi
      # New branch / first push: empty patch vs HEAD (project gate still runs).
      printf '%s\n' "HEAD"
      return 0
      ;;
  esac

  if [ -n "${DEFAULT_BRANCH:-}" ] && is_safe_ref "$DEFAULT_BRANCH"; then
    printf '%s\n' "$DEFAULT_BRANCH"
    return 0
  fi
  printf '%s\n' "HEAD"
}

main() {
  local base
  base="$(resolve_base)"
  ensure_fetched "$base"
  resolved_after_fetch "$base"
}

main
