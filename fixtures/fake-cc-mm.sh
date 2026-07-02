#!/bin/bash
# Fake cc-mm for integration testing.
# Reads STAGE from .adt/stage.txt and emits a canned result.
set -e

CWD="${CC_MM_CWD:-$(pwd)}"
STAGE_FILE="$CWD/.adt/stage.txt"

if [ -f "$STAGE_FILE" ]; then
  STAGE=$(cat "$STAGE_FILE")
  RESULT_FILE="$CWD/.adt/$STAGE-result.json"
  mkdir -p "$CWD/.adt"

  case "$STAGE" in
    reqs)
      echo '{"status":"waiting-user","summary":"What should the API return on error?"}' > "$RESULT_FILE"
      ;;
    design)
      mkdir -p "$CWD/docs/designs"
      echo "# Design for issue" > "$CWD/docs/designs/test.md"
      echo '{"status":"waiting-user","summary":"Design: docs/designs/test.md"}' > "$RESULT_FILE"
      ;;
    impl)
      echo "test" > "$CWD/result.txt"
      echo '{"status":"done","summary":"Implementation done"}' > "$RESULT_FILE"
      ;;
    review)
      echo '{"status":"done","summary":"PR: https://github.com/test/test/pull/1","artifacts":{"prUrl":"https://github.com/test/test/pull/1"}}' > "$RESULT_FILE"
      ;;
  esac
  exit 0
fi
exit 1
