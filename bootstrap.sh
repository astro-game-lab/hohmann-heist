#!/usr/bin/env bash
#
# Bootstrap a new astro-game-lab repository from this template.
#
#   ./bootstrap.sh <name> ["One-line description"]
#
# Fills in the placeholders across every file, then deletes itself. Everything
# after that is stack setup, which you do by hand for now.

set -euo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

readonly RED=$'\033[31m' GREEN=$'\033[32m' BOLD=$'\033[1m' DIM=$'\033[2m' OFF=$'\033[0m'

die() { printf '%s\n' "${RED}error:${OFF} $*" >&2; exit 1; }

usage() {
  cat <<EOF
${BOLD}bootstrap.sh${OFF} — start a new astro-game-lab repository from this template

  ${BOLD}usage:${OFF}  ./bootstrap.sh <name> ["One-line description"]

  ${BOLD}example:${OFF}
    ./bootstrap.sh orbit-runner "A rendezvous puzzle game in the browser."

  <name> is the repository name in lowercase kebab-case.

  Substitutes these placeholders everywhere, including in file and directory
  names, then removes itself:

    __GAME_SLUG__   orbit-runner    the name as given
    __GAME_NAME__   Orbit Runner    title-cased
    __GAME_PKG__    orbit_runner    as a valid identifier
    __GAME_DESC__   the description argument
    __YEAR__        the current year
EOF
}

if [[ $# -eq 0 || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

SLUG="$1"
DESC="${2:-An astro-game-lab game.}"

[[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]*[a-z0-9]$ ]] \
  || die "name must be lowercase kebab-case (letters, digits, hyphens), e.g. orbit-runner — got '$SLUG'"

# This rewrites the tree in place, so insist on a clean slate to fall back to.
if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  [[ -z "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]] \
    || die "working tree is dirty. Commit or stash first, so 'git checkout .' can undo this."
fi

NAME="$(printf '%s' "$SLUG" | tr '_-' '  ' \
  | awk '{ for (i=1;i<=NF;i++) $i = toupper(substr($i,1,1)) tolower(substr($i,2)); print }')"
PKG="$(printf '%s' "$SLUG" | tr 'A-Z' 'a-z' | tr '-' '_' | tr -cd 'a-z0-9_')"
if [[ "$PKG" =~ ^[0-9] ]]; then PKG="_$PKG"; fi
YEAR="$(date +%Y)"

printf '\n%s\n\n' "${BOLD}Bootstrapping${OFF} $NAME ${DIM}($SLUG)${OFF}"

# Swap the template's own README for the game's.
if [[ -f README.game.md ]]; then
  mv -f README.game.md README.md
fi

# Substitute inside every text file. grep -Iq skips binaries.
while IFS= read -r -d '' f; do
  grep -Iq . "$f" 2>/dev/null || continue
  perl -pi -e '
    BEGIN { ($s,$n,$p,$d,$y) = @ARGV[0..4]; splice(@ARGV,0,5); }
    s/__GAME_SLUG__/$s/g;
    s/__GAME_NAME__/$n/g;
    s/__GAME_PKG__/$p/g;
    s/__GAME_DESC__/$d/g;
    s/__YEAR__/$y/g;
  ' "$SLUG" "$NAME" "$PKG" "$DESC" "$YEAR" "$f"
done < <(find . -type f -not -path './.git/*' -print0)

# Rename any paths carrying placeholders, deepest first so parents stay valid.
while IFS= read -r path; do
  base="$(basename "$path")"
  newbase="${base//__GAME_SLUG__/$SLUG}"
  newbase="${newbase//__GAME_PKG__/$PKG}"
  newbase="${newbase//__GAME_NAME__/$NAME}"
  [[ "$base" == "$newbase" ]] && continue
  mv "$path" "$(dirname "$path")/$newbase"
done < <(find . -depth -name '*__GAME_*' -not -path './.git/*')

rm -f "$ROOT/bootstrap.sh"

printf '%s\n\n' "${GREEN}${BOLD}Done.${OFF} $NAME is ready."
cat <<EOF
${BOLD}Next steps${OFF}
  1. Set up the stack — toolchain, build config, and CI. There is no scaffold
     for this yet; copy from a sibling repo once one exists.
  2. Fill in ${BOLD}docs/PHYSICS.md${OFF} — units, frames, time scale, what you neglect,
     and how you validated it. This org does not let you skip it.
  3. Sketch ${BOLD}docs/DESIGN.md${OFF}, especially where the game layer departs
     from the physics.
  4. Review and commit:
       ${DIM}git add -A && git commit -m 'Bootstrap $SLUG from template'${OFF}
EOF
