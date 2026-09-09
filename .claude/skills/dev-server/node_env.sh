#!/usr/bin/env bash
# Source this to put the pinned Node (.nvmrc) first on PATH in a shell that
# has not loaded nvm, which is every non-interactive shell an agent runs.
#
#   . .claude/skills/dev-server/node_env.sh
#
# Order: an nvm install (nvm use reads .nvmrc), then the newest matching
# version under ~/.nvm/versions/node without nvm's shell function, then
# whatever node is already on PATH if it is new enough. Says what it picked
# on stderr; exits non-zero (returns, when sourced) if nothing fits.
_want="$(cat "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.nvmrc" 2>/dev/null || echo 22)"
_want="${_want#v}"
_ok() { node -v 2>/dev/null | grep -Eq "^v${_want}\." ; }

if ! _ok; then
  _nvm="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$_nvm/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$_nvm/nvm.sh" >/dev/null 2>&1
    nvm use "$_want" >/dev/null 2>&1 || nvm use >/dev/null 2>&1
  fi
fi
if ! _ok; then
  _dir="$(ls -d "${NVM_DIR:-$HOME/.nvm}"/versions/node/v"${_want}".*/bin 2>/dev/null | sort -V | tail -1)"
  [ -n "$_dir" ] && export PATH="$_dir:$PATH"
fi
if _ok; then
  echo "node $(node -v) ($(command -v node))" >&2
else
  echo "node ${_want}.x not found: install it with nvm (nvm install ${_want}), see .nvmrc" >&2
  false
fi
unset _want _nvm _dir
unset -f _ok
