#!/usr/bin/env bash
set -euo pipefail
start="$(dirname "${BASH_SOURCE[0]}")/start.sh"

# Stub commands: these tests never connect to a database or broker.
python() {
  echo "python $*"
  if [[ "$*" == "manage.py migrate --noinput" && "${FAIL_MIGRATION:-}" == primary ]]; then return 42; fi
  if [[ "$*" == *"--database=vectors"* && "${FAIL_MIGRATION:-}" == vector ]]; then return 43; fi
  return 0
}
celery() { echo "celery $*"; return 73; }
daphne() { echo "daphne started"; sleep 0.2; }
export -f python celery daphne

for scenario in primary vector worker; do
  code=0
  output=$(FAIL_MIGRATION="$scenario" VECTOR_DATABASE_URL="test-only" bash "$start" 2>&1) || code=$?
  case "$scenario" in
    primary)
      [[ "$code" == 42 && "$output" != *celery* && "$output" != *daphne* && "$output" != *vectors* ]]
      ;;
    vector)
      [[ "$code" == 43 && "$output" != *celery* && "$output" != *daphne* ]]
      ;;
    worker)
      [[ "$code" != 0 && "$output" == *celery* ]]
      ;;
  esac
  echo "PASS: $scenario failure stops startup/services"
done
