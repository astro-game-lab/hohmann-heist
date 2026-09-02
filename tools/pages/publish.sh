#!/usr/bin/env bash
#
# Publish a directory to, or remove one from, the `gh-pages` branch.
#
#   tools/pages/publish.sh publish dist .                 "deploy: ..."
#   tools/pages/publish.sh publish dist pr-preview/pr-30  "preview: ..."
#   tools/pages/publish.sh remove       pr-preview/pr-30  "preview: ..."
#
# GitHub Pages serves one site per repository, so production and every pull-request
# preview have to coexist inside a single published tree. They are kept apart by
# path: production owns the root, previews own `pr-preview/pr-<n>/`, and neither
# writes into the other's territory. A root publish deletes everything it is
# replacing *except* `pr-preview/`, which is the single line that stops a merge to
# main from wiping every open PR's preview.
#
# Hand-rolled git rather than a publishing action, for the same reason
# tools/smoke/smoke.sh is hand-rolled curl: it is a dozen lines of git, it adds
# nothing to the supply chain, and it can be run locally against a scratch remote
# to see what it does before it is trusted with the real one.
#
# Concurrent writers are handled here rather than by queueing them in the
# workflows: a production deploy and any number of preview publishes can run at
# once, and a push rejected because another landed first is retried from the new
# tip. Because each writer only ever rewrites its own path, replaying on top of a
# newer tree converges rather than clobbering -- which is what makes it safe to
# give previews a concurrency group each instead of one shared queue.

set -euo pipefail

readonly BRANCH='gh-pages'
readonly PRESERVE='pr-preview'
readonly PUSH_ATTEMPTS=5

die() {
  printf 'publish: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat >&2 <<'USAGE'
usage: publish.sh publish <source-dir> <target-path> <message>
       publish.sh remove <target-path> <message>

  <target-path>  '.' for the site root, or a relative path such as
                 'pr-preview/pr-30'. May not be absolute or contain '..'.
USAGE
  exit 2
}

mode=${1:-}
case "$mode" in
  publish)
    source_dir=${2:-}
    target=${3:-}
    message=${4:-}
    [ -n "$source_dir" ] && [ -n "$target" ] && [ -n "$message" ] || usage
    [ -d "$source_dir" ] || die "source directory '$source_dir' does not exist"
    source_dir=$(cd "$source_dir" && pwd)
    ;;
  remove)
    target=${2:-}
    message=${3:-}
    [ -n "$target" ] && [ -n "$message" ] || usage
    source_dir=''
    ;;
  *) usage ;;
esac

# A target that escapes the tree would let a preview overwrite production, which is
# the one thing the path split exists to prevent.
case "$target" in
  /* | *..*) die "target path '$target' must be relative and free of '..'" ;;
esac
[ "$mode" = 'remove' ] && [ "$target" = '.' ] && die 'refusing to remove the site root'

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
  if [ "$mode" = 'remove' ]; then
    rm -rf "${worktree:?}/${target}"
    return
  fi

  if [ "$target" = '.' ]; then
    # Replace the root wholesale, but never the previews living under it.
    find "$worktree" -mindepth 1 -maxdepth 1 \
      ! -name '.git' ! -name "$PRESERVE" -exec rm -rf {} +
    cp -R "$source_dir"/. "$worktree"/
  else
    rm -rf "${worktree:?}/${target}"
    mkdir -p "${worktree}/${target}"
    cp -R "$source_dir"/. "${worktree}/${target}"/
  fi

  # Without this, Pages runs the tree through Jekyll, which costs build time and
  # drops files whose names begin with an underscore.
  touch "$worktree/.nojekyll"
}

for attempt in $(seq "$PUSH_ATTEMPTS"); do
  prepare
  apply

  git -C "$worktree" add --all
  if git -C "$worktree" diff --cached --quiet; then
    printf 'publish: %s is already up to date; nothing to push\n' "$target"
    exit 0
  fi

  git -C "$worktree" \
    -c "user.name=$AUTHOR_NAME" -c "user.email=$AUTHOR_EMAIL" \
    commit --quiet --message "$message"

  if git -C "$worktree" push origin "HEAD:refs/heads/$BRANCH"; then
    printf 'publish: %s %s on %s\n' \
      "$([ "$mode" = 'remove' ] && echo 'removed' || echo 'published')" "$target" "$BRANCH"
    exit 0
  fi

  printf 'publish: push rejected (attempt %s/%s); rebuilding on the new tip\n' \
    "$attempt" "$PUSH_ATTEMPTS" >&2
done

die "could not push to $BRANCH after $PUSH_ATTEMPTS attempts"
