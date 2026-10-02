#!/usr/bin/env bash
# Separate runners keep software-GPU contention and memory measurements isolated.
set -uo pipefail

case "${SUITE_GROUP:-}" in
  site|retirement|efield|invalidation|viewer) ;;
  *) echo "Unknown WebGPU suite group: ${SUITE_GROUP:-}" >&2; exit 2 ;;
esac

failed=()
selected=0
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
printf '| Suite | Seconds | Exit code |\n| --- | ---: | ---: |\n' >> "$summary"
for suite in site/test/run-browser.mjs packages/viewer/test/run-*.mjs \
  packages/fields/test/run-browser.mjs packages/dynamics/test/run-browser.mjs; do
  case "$suite" in
    site/*) group=site ;;
    */run-retirement.mjs) group=retirement ;;
    */run-efield.mjs|packages/fields/*|packages/dynamics/*) group=efield ;;
    */run-invalidation.mjs) group=invalidation ;;
    *) group=viewer ;;
  esac
  [[ "$group" == "$SUITE_GROUP" ]] || continue
  selected=$((selected + 1))
  # List mode verifies the partition locally without launching browsers.
  if [[ "${MOLGPU_CI_LIST_ONLY:-0}" == 1 ]]; then
    echo "$suite"
    continue
  fi
  echo "::group::$suite"
  started=$SECONDS
  timeout 15m deno test -A "$suite"
  result=$?
  elapsed=$((SECONDS - started))
  printf '| `%s` | %s | %s |\n' "$suite" "$elapsed" "$result" >> "$summary"
  ((result == 0)) || failed+=("$suite (exit $result, ${elapsed}s)")
  echo "::endgroup::"
done
if ((selected == 0)); then
  echo "No suites selected for $SUITE_GROUP" >&2
  exit 2
fi
if ((${#failed[@]})); then
  printf '::error::failed: %s\n' "${failed[@]}"
  exit 1
fi
