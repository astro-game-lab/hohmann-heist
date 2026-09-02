#!/usr/bin/env bash
#
# Post or update the preview comment on a pull request.
#
#   tools/pages/pr-comment.sh <pr-number> <body-file>
#
# One comment per pull request, edited in place rather than appended to, so a PR
# pushed to twenty times carries one current preview link instead of twenty stale
# ones. The comment is found again by a hidden marker in its body; nothing else
# about it is load-bearing, so a human editing the text will not break the next
# update.
#
# Needs GH_TOKEN and GITHUB_REPOSITORY in the environment.

set -euo pipefail

readonly MARKER='<!-- hohmann-heist:preview -->'

pr=${1:-}
body_file=${2:-}
if [ -z "$pr" ] || [ -z "$body_file" ]; then
  echo "usage: ${0##*/} <pr-number> <body-file>" >&2
  exit 2
fi
[ -f "$body_file" ] || {
  echo "pr-comment: no such file: $body_file" >&2
  exit 1
}

repo=${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}
body=$(printf '%s\n%s\n' "$MARKER" "$(cat "$body_file")")

# --paginate applies the filter per page, so a match on a later page arrives on
# its own line; the first one wins.
existing=$(gh api "repos/$repo/issues/$pr/comments" --paginate \
  --jq "map(select(.body | startswith(\"$MARKER\"))) | .[0].id // empty" |
  head -n 1)

if [ -n "$existing" ]; then
  gh api -X PATCH "repos/$repo/issues/comments/$existing" -f "body=$body" >/dev/null
  printf 'pr-comment: updated comment %s on #%s\n' "$existing" "$pr"
else
  gh api -X POST "repos/$repo/issues/$pr/comments" -f "body=$body" >/dev/null
  printf 'pr-comment: created a comment on #%s\n' "$pr"
fi
