#!/usr/bin/env bash
#
# Publish a directory to the `gh-pages` branch.
#
#   tools/pages/publish.sh dist "deploy: ..."
#
# The published tree is the site, whole: a publish replaces everything on the
# branch with the build it was handed. It used to preserve `pr-preview/` and to
# offer a `remove` mode, because pull requests published previews into that path
# and a deploy to the root had to leave them standing. Both went when the previews
# did, and the first publish after that removal carries the stale preview
# directories away with it.
#
# Hand-rolled git rather than a publishing action, for the same reason
# tools/smoke/smoke.sh is hand-rolled curl: it is a dozen lines of git, it adds
# nothing to the supply chain, and it can be run locally against a scratch remote
# to see what it does before it is trusted with the real one.
#
# A push rejected because another landed first is retried from the new tip rather
# than failing the deploy. The deploy workflow serialises its own runs, so what
# this covers is a writer that workflow does not know about -- a build published
# by hand, an edit made on the branch directly.

set -euo pipefail

readonly BRANCH='gh-pages'
readonly PUSH_ATTEMPTS=5

die() {
  printf 'publish: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat >&2 <<'USAGE'
usage: publish.sh <source-dir> <message>

  <source-dir>  the built site; its contents become the root of gh-pages
  <message>     the commit message for the publishing commit
USAGE
  exit 2
}

source_dir=${1:-}
message=${2:-}
[ -n "$source_dir" ] && [ -n "$message" ] || usage
[ -d "$source_dir" ] || die "source directory '$source_dir' does not exist"
source_dir=$(cd "$source_dir" && pwd)

repo_root=$(git rev-parse --show-toplevel)
worktree=$(mktemp -d)
cleanup() { git -C "$repo_root" worktree remove --force "$worktree" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Deployment commits are machine output, so they carry the machine's identity
# rather than borrowing whoever's push triggered the run. Passed per-command with
# `-c` rather than written with `git config`: run locally against a scratch remote,
# this must not leave an identity override behind in the working clone.
readonly AUTHOR_NAME='github-actions[bot]'
readonly AUTHOR_EMAIL='41898282+github-actions[bot]@users.noreply.github.com'

# Lay out the branch's current state, creating it as an orphan the first time.
prepare() {
  rm -rf "$worktree"
  git -C "$repo_root" worktree prune
  git -C "$repo_root" worktree add --no-checkout --detach "$worktree" >/dev/null

  if git -C "$repo_root" ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
    git -C "$worktree" fetch --depth=1 origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
    git -C "$worktree" checkout -B "$BRANCH" "refs/remotes/origin/$BRANCH" >/dev/null
  else
    printf 'publish: %s does not exist on origin; creating it\n' "$BRANCH"
    git -C "$worktree" checkout --orphan "$BRANCH" >/dev/null
    git -C "$worktree" rm -rf --cached . >/dev/null 2>&1 || true
    find "$worktree" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
  fi
}

apply() {
  # Replace the tree wholesale. Anything the new build does not carry is not part
  # of the site, and leaving it would make the branch an archive of every build
  # that has ever shipped rather than a copy of the current one.
  find "$worktree" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
  cp -R "$source_dir"/. "$worktree"/

  # Without this, Pages runs the tree through Jekyll, which costs build time and
  # drops files whose names begin with an underscore.
  touch "$worktree/.nojekyll"
}

for attempt in $(seq "$PUSH_ATTEMPTS"); do
  prepare
  apply

  git -C "$worktree" add --all
  if git -C "$worktree" diff --cached --quiet; then
    printf 'publish: %s is already serving this build; nothing to push\n' "$BRANCH"
    exit 0
  fi

  git -C "$worktree" \
    -c "user.name=$AUTHOR_NAME" -c "user.email=$AUTHOR_EMAIL" \
    commit --quiet --message "$message"

  if git -C "$worktree" push origin "HEAD:refs/heads/$BRANCH"; then
    printf 'publish: published to %s\n' "$BRANCH"
    exit 0
  fi

  printf 'publish: push rejected (attempt %s/%s); rebuilding on the new tip\n' \
    "$attempt" "$PUSH_ATTEMPTS" >&2
done

die "could not push to $BRANCH after $PUSH_ATTEMPTS attempts"
