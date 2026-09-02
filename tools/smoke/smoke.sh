#!/usr/bin/env bash
#
# Smoke-test a deployed build.
#
# Takes the URL of a deployment and asserts that a browser opening it would get a
# working game rather than a blank page. Deliberately dependency-free — curl and a
# shell, nothing to install — so it runs identically in CI and against a local
# `pnpm preview`.
#
#   tools/smoke/smoke.sh https://astro-game-lab.github.io/hohmann-heist/
#   tools/smoke/smoke.sh http://localhost:4173/hohmann-heist/
#
# The third assertion is the one that earns its keep. A wrong Vite `base` produces
# a document that serves 200 with the right title and a plausible-looking script
# tag, and renders nothing at all, because the script 404s. Checking the document
# alone would pass that build.

set -euo pipefail

readonly BASE_PATH='/hohmann-heist/'
readonly EXPECTED_TITLE='<title>Hohmann Heist</title>'
readonly RETRIES=5
readonly RETRY_DELAY=3

url=${1:-}
if [ -z "$url" ]; then
  echo "usage: ${0##*/} <url>" >&2
  exit 2
fi

pass() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n' "$1" >&2
  exit 1
}

# Echoes the HTTP status code and writes the body to $2. Retries a non-2xx a few
# times: a deployment can be reported live a beat before every edge node agrees.
http_get() {
  local target=$1 out=$2 code='000' attempt
  for attempt in $(seq "$RETRIES"); do
    code=$(curl -sS -L -o "$out" -w '%{http_code}' \
      --connect-timeout 10 --max-time 30 "$target" 2>/dev/null || echo '000')
    case "$code" in
      2??) break ;;
    esac
    [ "$attempt" -lt "$RETRIES" ] && sleep "$RETRY_DELAY"
  done
  echo "$code"
}

# One trailing slash, so the document URL is unambiguous.
doc_url="${url%/}/"

# The built script tag is a root-absolute path, so resolving it needs the origin
# rather than the document URL.
scheme_and_rest="${doc_url#*://}"
origin="${doc_url%%://*}://${scheme_and_rest%%/*}"

document=$(mktemp)
asset=$(mktemp)
trap 'rm -f "$document" "$asset"' EXIT

echo "smoke: $doc_url"

# 1 — the document is served at all.
status=$(http_get "$doc_url" "$document")
[ "$status" = '200' ] || fail "document returned HTTP $status"
pass "document responds 200"

# 2 — it is our document, and it carries a hashed module script under our base.
grep -qF "$EXPECTED_TITLE" "$document" || fail "document is missing $EXPECTED_TITLE"
pass 'document is the Hohmann Heist shell'

script_src=$(grep -oE 'src="[^"]*/assets/[^"]*\.js"' "$document" | head -n 1 |
  sed -E 's/^src="//; s/"$//') || true
[ -n "$script_src" ] || fail 'document references no built module script'

case "$script_src" in
  "${BASE_PATH}assets/"*) ;;
  *) fail "script src '$script_src' is not under $BASE_PATH — check Vite's \`base\`" ;;
esac
pass "module script is under $BASE_PATH ($script_src)"

# 3 — and that script actually exists. Content type as well as status: a host that
# serves the index document for unknown paths would answer 200 to anything.
case "$script_src" in
  /*) asset_url="${origin}${script_src}" ;;
  *) asset_url="${doc_url}${script_src}" ;;
esac

status=$(http_get "$asset_url" "$asset")
[ "$status" = '200' ] || fail "module script returned HTTP $status"

content_type=$(curl -sS -L -o /dev/null -w '%{content_type}' \
  --connect-timeout 10 --max-time 30 "$asset_url" 2>/dev/null || echo '')
case "$content_type" in
  *javascript* | *ecmascript*) ;;
  *) fail "module script served as '$content_type', not JavaScript" ;;
esac
pass "module script responds 200 as $content_type"

echo 'smoke: all checks passed'
