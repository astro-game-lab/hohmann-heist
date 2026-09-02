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
#   tools/smoke/smoke.sh .../hohmann-heist/pr-preview/pr-30/ assets/index-BUeQDV-6.js
#   tools/smoke/smoke.sh http://localhost:4173/hohmann-heist/
#
# The optional second argument pins the entry script the deployment is expected to
# be serving, relative to the base path. Pass it after a deploy and omit it when
# checking whatever is currently live.
#
# The third assertion is the one that earns its keep. A wrong Vite `base` produces
# a document that serves 200 with the right title and a plausible-looking script
# tag, and renders nothing at all, because the script 404s. Checking the document
# alone would pass that build.
#
# The expected base path is taken from the URL rather than hardcoded, because the
# whole assertion is that the build's `base` agrees with where it is being served
# from -- and a pull-request preview is served from a different path than
# production. Hardcoding production's path would make this pass a preview built
# with the wrong base, which is precisely the failure previews exist to surface.
#
# SMOKE_RETRIES and SMOKE_RETRY_DELAY widen the poll. A Pages branch build is
# slower to go live than an artifact deployment, so the preview workflow asks for
# longer than the default.

set -euo pipefail

readonly EXPECTED_TITLE='<title>Hohmann Heist</title>'
readonly RETRIES=${SMOKE_RETRIES:-5}
readonly RETRY_DELAY=${SMOKE_RETRY_DELAY:-3}

url=${1:-}
expected_entry=${2:-}
if [ -z "$url" ]; then
  echo "usage: ${0##*/} <url> [expected-entry-path]" >&2
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

# What Vite's `base` must have been for this deployment. Everything after the
# origin, one trailing slash already guaranteed above.
base_path="${doc_url#"$origin"}"

# The exact script tag this deployment must be serving, if the caller pinned one.
expected_src=''
[ -n "$expected_entry" ] && expected_src="${base_path}${expected_entry#/}"

document=$(mktemp)
asset=$(mktemp)
trap 'rm -f "$document" "$asset"' EXIT

echo "smoke: $doc_url"

# 1 — the document is served at all, and is the build the caller expected.
#
# The freshness check is what makes this safe to run immediately after publishing.
# A Pages site keeps serving the previous build until the new one goes live, and
# the previous build passes every other assertion in this file -- so a smoke test
# run too early would go green against exactly the deployment it was meant to be
# replacing. Waiting for the expected entry script to appear is both the wait and
# the proof that the wait ended for the right reason.
fetch_document() {
  local attempt code='000' seen_ok=''
  for attempt in $(seq "$RETRIES"); do
    code=$(curl -sS -L -o "$document" -w '%{http_code}' \
      --connect-timeout 10 --max-time 30 "$doc_url" 2>/dev/null || echo '000')
    if [ "$code" = '200' ]; then
      [ -z "$expected_src" ] && return 0
      grep -qF "\"$expected_src\"" "$document" && return 0
      seen_ok='yes'
    fi
    [ "$attempt" -lt "$RETRIES" ] && sleep "$RETRY_DELAY"
  done

  if [ -n "$seen_ok" ]; then
    fail "document never referenced $expected_src within ~$((RETRIES * RETRY_DELAY))s; the deployment is still serving an older build"
  fi
  fail "document returned HTTP $code"
}

fetch_document
pass 'document responds 200'
if [ -n "$expected_src" ]; then
  pass "document is serving the expected build ($expected_entry)"
fi

# 2 — it is our document, and it carries a hashed module script under our base.
grep -qF "$EXPECTED_TITLE" "$document" || fail "document is missing $EXPECTED_TITLE"
pass 'document is the Hohmann Heist shell'

script_src=$(grep -oE 'src="[^"]*/assets/[^"]*\.js"' "$document" | head -n 1 |
  sed -E 's/^src="//; s/"$//') || true
[ -n "$script_src" ] || fail 'document references no built module script'

case "$script_src" in
  "${base_path}assets/"*) ;;
  *) fail "script src '$script_src' is not under $base_path — check Vite's \`base\`" ;;
esac
pass "module script is under $base_path ($script_src)"

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
