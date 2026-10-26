#!/usr/bin/env bash
# land-pro.sh <agent-id> <T###> : land a Pro task's commits in the separate, proprietary Pro repo (R40).
# land.sh runs it after landing the public side, because Pro builds link the public main checkout.
# The agent's Pro worktree is $SEMICS_PRO_WORKTREES/agent-<id> on branch pro-agent-<id>: rebase it on
# Pro main, fast-forward Pro main, reinstall, remove the worktree. No Pro worktree: nothing to do.
# This script only moves commits; no Pro code ever enters this repo. It is bash, not zsh, so its tests run
# on CI's ubuntu runners (T123).
set -e
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:/opt/homebrew/bin:$PATH"
PRO=${SEMICS_PRO_REPO:-/Users/semics/code/semics/emdash-plugins-pro}
PWS=${SEMICS_PRO_WORKTREES:-/Users/semics/code/semics/.pro-worktrees}
PW=$PWS/agent-$1; B=pro-agent-$1; T=$2
[[ -d $PW ]] || { echo "no Pro worktree for $T ($PW)"; exit 0; }
[[ -z "$(git -C "$PW" status --porcelain)" ]] || { echo "DIRTY Pro worktree $PW"; exit 1; }
G=(git -C "$PW" -c user.name="Ollie Breeden" -c user.email="olliebreeden1@gmail.com")
if ! "${G[@]}" rebase -q main; then
  git -C "$PW" rebase --abort
  echo "CONFLICT rebasing $B on Pro main; resolve in $PW"
  exit 2
fi
git -C "$PRO" merge -q --ff-only "$B"
if [[ -f $PRO/package.json ]]; then (cd "$PRO" && corepack pnpm@10.23.0 install --offline --reporter=silent); fi
git -C "$PRO" worktree remove --force "$PW"
git -C "$PRO" branch -D "$B" >/dev/null
echo "LANDED PRO $T"
