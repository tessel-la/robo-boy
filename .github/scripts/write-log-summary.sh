#!/usr/bin/env bash
set -euo pipefail

title="$1"
status="$2"
log_file="$3"
command_label="$4"
max_lines="${5:-160}"

{
  echo "### ${title}"
  echo ""
  echo "- Command: \`${command_label}\`"
  echo "- Exit code: \`${status}\`"
  echo ""

  if [ "${status}" = "0" ]; then
    echo "Passed."
  else
    echo "<details open>"
    echo "<summary>Failure output, last ${max_lines} lines</summary>"
    echo ""
    echo '```text'
    if [ -f "${log_file}" ]; then
      tail -n "${max_lines}" "${log_file}" | sed -E 's/\x1B\[[0-9;]*[A-Za-z]//g'
    else
      echo "Log file not found: ${log_file}"
    fi
    echo '```'
    echo ""
    echo "</details>"
  fi

  echo ""
} >> "${GITHUB_STEP_SUMMARY}"
