#!/bin/zsh
# land.sh <agent-id> <T###> : rebase worktree branch on main (auto-resolving shared index.ts export conflicts),
# mark done, ff-merge, install, regenerate board, commit, remove worktree.
set -e
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:/opt/homebrew/bin:$PATH"
M=/Users/semics/code/semics/emdash-plugins; W=$M/.claude/worktrees/agent-$1; B=worktree-agent-$1; T=$2
TR=$'\n\nCo-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01F16noC7oiT3hiZEQPwcgnD'
G=(git -C $W -c user.name="Ollie Breeden" -c user.email="olliebreeden1@gmail.com")
[[ -z "$(git -C $W status --porcelain)" ]] || { echo "DIRTY worktree"; exit 1; }
if ! $G rebase -q main 2>/dev/null; then
  while true; do
    U=$(git -C $W diff --name-only --diff-filter=U)
    # The task file is marked in-progress on main at launch; the branch's copy (status, ticks, Notes) wins.
    for f in ${(f)U}; do [[ "$f" == tasks/$T-*.md ]] && git -C $W checkout --theirs -- "$f" && git -C $W add "$f"; done
    U=$(git -C $W diff --name-only --diff-filter=U)
    [[ -z "$U" ]] && { GIT_EDITOR=true $G rebase --continue >/dev/null 2>&1 && break; continue; }
    [[ "$U" == "packages/shared/src/index.ts" ]] || { echo "CONFLICT: $U"; exit 2; }
    F=$W/$U; grep -v -E '^(<<<<<<<|=======|>>>>>>>)' $F | awk '!(/^export \* from/ && seen[$0]++)' > $F.tmp && mv $F.tmp $F
    (cd $W && corepack pnpm@10.23.0 exec biome check --write $U >/dev/null 2>&1 || true)
    git -C $W add $U
    GIT_EDITOR=true $G rebase --continue >/dev/null 2>&1 && break
  done
  echo REBASED_WITH_INDEX_FIX
fi
sed -i '' 's/^status: .*/status: done/' $W/tasks/$T-*.md
$G commit -qam "chore($T): mark done$TR"
cd $M && git merge -q --ff-only $B
corepack pnpm@10.23.0 install --offline --reporter=silent
node scripts/tasks.mjs >/dev/null
git add -A && git -c user.name="Ollie Breeden" -c user.email="olliebreeden1@gmail.com" commit -qm "Regenerate board after $T$TR" || true
git worktree remove --force $W 2>/dev/null && git branch -D $B >/dev/null || echo "worktree locked; remove later"
echo "LANDED $T"
