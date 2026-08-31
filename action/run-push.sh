#!/usr/bin/env bash
# Run `tested push` for the GitHub Action.
#
# All caller-controlled values MUST arrive as env vars (set from ${{ }} in
# action.yml). Never interpolate GitHub expressions into this script.
#
# Env:
#   INPUT_TOKEN        action token input (wins over ambient TESTED_TOKEN)
#   INPUT_API_URL      action api-url input (only source of --url)
#   INPUT_PR_NUMBER    action pr-number input
#   INPUT_JUNIT        action junit input
#   INPUT_MAINLINE     action mainline input
#   INPUT_REPOSITORY   github.repository (owner/name) — not git remote
#   INPUT_BASE         optional git base override (same as check)
#   INPUT_FILES        newline/comma-separated coverage files to merge
#   INPUT_PARTS        total shard count
#   INPUT_PART         1-based shard index
#   INPUT_COMPLETE     true | false | empty (infer from parts/part)
#   INPUT_RUN_ID       optional run id
#   INPUT_SHARD        optional shard label
#   INPUT_FLAG         optional flag name (coverage file is that flag)
#   ACTION_PATH        github.action_path (resolve-check-base.sh)
#   EVENT_NAME         github.event_name
#   EVENT_PR_NUMBER    github.event.pull_request.number
#   PR_BASE_SHA        github.event.pull_request.base.sha
#   PR_BASE_REF        github.event.pull_request.base.ref
#   GITHUB_BASE_REF    github.base_ref
#   PUSH_BEFORE        github.event.before
#   DEFAULT_BRANCH     github.event.repository.default_branch
#   REF_NAME           github.ref_name
set -euo pipefail

SAFE_REPO_RE='^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'

# Ambient env from a prior untrusted step (tests writing GITHUB_ENV) must not
# steer the Bearer token or rewrite the ingest destination.
unset TESTED_ALLOW_CUSTOM_API_URL
unset TESTED_API_URL
unset TESTED_JUNIT
unset TESTED_COVERAGE_FILES
unset TESTED_PARTS
unset TESTED_PART
unset TESTED_RUN_ID
unset TESTED_SHARD
unset GITHUB_PR_NUMBER
unset PR_NUMBER
unset GITHUB_REPOSITORY

if [ -n "${INPUT_TOKEN:-}" ]; then
  export TESTED_TOKEN="$INPUT_TOKEN"
fi

if [ -n "${INPUT_API_URL:-}" ]; then
  export TESTED_API_URL="$INPUT_API_URL"
  export TESTED_ALLOW_CUSTOM_API_URL=1
fi

# Prefer an explicit junit input; otherwise the first common report under cwd
# (the Action step already sets working-directory).
# Candidate order must match DEFAULT_JUNIT_CANDIDATES in src/commands/push.ts.
if [ -z "${INPUT_JUNIT:-}" ]; then
  for candidate in junit.xml test-results/junit.xml coverage/junit.xml reports/junit.xml; do
    if [ -f "$candidate" ]; then
      INPUT_JUNIT="$candidate"
      break
    fi
  done
fi
if [ -n "${INPUT_JUNIT:-}" ]; then
  export TESTED_JUNIT="$INPUT_JUNIT"
  echo "tested push: using JUnit report $INPUT_JUNIT"
fi

if [ -n "${INPUT_PR_NUMBER:-}" ]; then
  export GITHUB_PR_NUMBER="$INPUT_PR_NUMBER"
elif [ -n "${EVENT_PR_NUMBER:-}" ]; then
  export GITHUB_PR_NUMBER="$EVENT_PR_NUMBER"
fi

if [ -z "${TESTED_TOKEN:-}" ]; then
  echo "push=true requires token input or TESTED_TOKEN" >&2
  exit 1
fi

if [ -z "${ACTION_PATH:-}" ]; then
  echo "error: ACTION_PATH is required to resolve the git base" >&2
  exit 1
fi
if [ -z "${PR_BASE_REF:-}" ] && [ -n "${GITHUB_BASE_REF:-}" ]; then
  PR_BASE_REF="$GITHUB_BASE_REF"
fi
BASE="$(bash "${ACTION_PATH}/resolve-check-base.sh")"
echo "tested push --base $BASE"

EXTRA_URL=()
if [ -n "${INPUT_API_URL:-}" ]; then
  EXTRA_URL=(--url "$INPUT_API_URL")
fi

EXTRA_JUNIT=()
if [ -n "${INPUT_JUNIT:-}" ]; then
  EXTRA_JUNIT=(--junit "$INPUT_JUNIT")
fi

EXTRA_FILES=()
if [ -n "${INPUT_FILES:-}" ]; then
  export TESTED_COVERAGE_FILES="$INPUT_FILES"
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    EXTRA_FILES+=(--file "$line")
  done < <(printf '%s\n' "$INPUT_FILES" | tr ',' '\n')
fi

EXTRA_MERGE=()
if [ -n "${INPUT_PARTS:-}" ]; then
  EXTRA_MERGE+=(--parts "$INPUT_PARTS")
  export TESTED_PARTS="$INPUT_PARTS"
fi
if [ -n "${INPUT_PART:-}" ]; then
  EXTRA_MERGE+=(--part "$INPUT_PART")
  export TESTED_PART="$INPUT_PART"
fi
if [ "${INPUT_COMPLETE:-}" = "true" ]; then
  EXTRA_MERGE+=(--complete)
elif [ "${INPUT_COMPLETE:-}" = "false" ]; then
  EXTRA_MERGE+=(--incomplete)
fi
if [ -n "${INPUT_RUN_ID:-}" ]; then
  EXTRA_MERGE+=(--run-id "$INPUT_RUN_ID")
  export TESTED_RUN_ID="$INPUT_RUN_ID"
elif [ -n "${INPUT_PARTS:-}" ] && [ -n "${GITHUB_RUN_ID:-}" ]; then
  EXTRA_MERGE+=(--run-id "$GITHUB_RUN_ID")
  export TESTED_RUN_ID="$GITHUB_RUN_ID"
fi
if [ -n "${INPUT_SHARD:-}" ]; then
  EXTRA_MERGE+=(--shard "$INPUT_SHARD")
  export TESTED_SHARD="$INPUT_SHARD"
fi

EXTRA_FLAG=()
if [ -n "${INPUT_FLAG:-}" ]; then
  EXTRA_FLAG+=(--flag "$INPUT_FLAG")
fi

EXTRA_REPO=()
if [[ "${INPUT_REPOSITORY:-}" =~ $SAFE_REPO_RE ]]; then
  export GITHUB_REPOSITORY="$INPUT_REPOSITORY"
  EXTRA_REPO=(--owner "${INPUT_REPOSITORY%/*}" --name "${INPUT_REPOSITORY#*/}")
else
  unset GITHUB_REPOSITORY
fi

MAINLINE="${INPUT_MAINLINE:-}"
if [ "$MAINLINE" != "true" ] && [ "${EVENT_NAME:-}" = "push" ]; then
  DEF="${DEFAULT_BRANCH:-}"
  REF="${REF_NAME:-}"
  if [ -n "$DEF" ] && [ "$REF" = "$DEF" ]; then
    MAINLINE=true
  fi
fi

if [ "$MAINLINE" = "true" ]; then
  echo "tested push --mainline --base $BASE"
  tested push --mainline --base "$BASE" "${EXTRA_REPO[@]}" "${EXTRA_URL[@]}" "${EXTRA_JUNIT[@]}" "${EXTRA_FILES[@]}" "${EXTRA_MERGE[@]}" "${EXTRA_FLAG[@]}"
  exit 0
fi

PR="${GITHUB_PR_NUMBER:-}"
if [ -z "$PR" ]; then
  echo "push=true requires pr-number, a pull_request event, or mainline=true / push to default branch" >&2
  exit 1
fi

echo "tested push --pr $PR --base $BASE"
tested push --pr "$PR" --base "$BASE" "${EXTRA_REPO[@]}" "${EXTRA_URL[@]}" "${EXTRA_JUNIT[@]}" "${EXTRA_FILES[@]}" "${EXTRA_MERGE[@]}" "${EXTRA_FLAG[@]}"
