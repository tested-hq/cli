#!/usr/bin/env bash
# Run `tested check` for the GitHub Action.
#
# All caller-controlled values MUST arrive as env vars (set from ${{ }} in
# action.yml). Never interpolate GitHub expressions into this script.
#
# Env:
#   INPUT_BASE         optional git base override
#   INPUT_FILES        newline/comma-separated coverage files to merge
#   INPUT_PARTS        total shard count
#   INPUT_PART         1-based shard index
#   INPUT_COMPLETE     true | false | empty (infer from parts/part)
#   INPUT_RUN_ID       optional run id (default github.run_id when parts set)
#   INPUT_SHARD        optional shard label
#   ACTION_PATH        github.action_path (resolve-check-base.sh)
#   EVENT_NAME, PR_BASE_SHA, PR_BASE_REF, GITHUB_BASE_REF,
#   PUSH_BEFORE, DEFAULT_BRANCH
set -euo pipefail

# Ambient env from a prior untrusted step must not steer the gate.
unset TESTED_COVERAGE_FILES
unset TESTED_PARTS
unset TESTED_PART
unset TESTED_RUN_ID
unset TESTED_SHARD

if [ -z "${ACTION_PATH:-}" ]; then
  echo "error: ACTION_PATH is required to resolve the git base" >&2
  exit 1
fi
if [ -z "${PR_BASE_REF:-}" ] && [ -n "${GITHUB_BASE_REF:-}" ]; then
  PR_BASE_REF="$GITHUB_BASE_REF"
fi
BASE="$(bash "${ACTION_PATH}/resolve-check-base.sh")"

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
  export TESTED_RUN_ID="$INPUT_RUN_ID"
elif [ -n "${INPUT_PARTS:-}" ] && [ -n "${GITHUB_RUN_ID:-}" ]; then
  export TESTED_RUN_ID="$GITHUB_RUN_ID"
fi
if [ -n "${INPUT_SHARD:-}" ]; then
  export TESTED_SHARD="$INPUT_SHARD"
fi

echo "tested check --base $BASE"
tested check --base "$BASE" "${EXTRA_FILES[@]}" "${EXTRA_MERGE[@]}"
