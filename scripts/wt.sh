#!/usr/bin/env bash
# Worktree leases for worker windows (see docs/ORCHESTRATION.md).
#   scripts/wt.sh new  <task> <slot>   create ../metabuild-wt/<task> on branch wt/<task>
#   scripts/wt.sh done <task>          remove the worktree and its branch (after merge)
#   scripts/wt.sh list                 show worktrees
# Slot N gets server port 8790+N and Vite port 5180+N, so leases run live side by side.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WT="$(dirname "$ROOT")/metabuild-wt"
cmd="${1:-list}"; task="${2:-}"; slot="${3:-}"

case "$cmd" in
  new)
    [[ -n "$task" && -n "$slot" ]] || { echo "usage: wt.sh new <task> <slot>"; exit 1; }
    dir="$WT/$task"
    git -C "$ROOT" worktree add "$dir" -b "wt/$task" main
    cp "$ROOT/.env" "$dir/.env"
    # Share node_modules through a junction; adding a dependency means flagging the orchestrator.
    powershell -NoProfile -Command "New-Item -ItemType Junction -Path '$(cygpath -w "$dir/node_modules")' -Target '$(cygpath -w "$ROOT/node_modules")' | Out-Null"
    cat >> "$dir/.env" <<EOF

# lease ports (slot $slot)
PORT=$((8790 + slot))
VITE_PORT=$((5180 + slot))
VITE_WS_URL=ws://127.0.0.1:$((8790 + slot))
EOF
    echo "leased $dir  branch wt/$task  server :$((8790 + slot))  vite :$((5180 + slot))"
    ;;
  done)
    [[ -n "$task" ]] || { echo "usage: wt.sh done <task>"; exit 1; }
    dir="$WT/$task"
    # Keep gitignored worker output (clips, briefs, notes): worktree removal would delete it.
    [[ -d "$dir/output" ]] && mkdir -p "$ROOT/output/wt" && cp -r "$dir/output" "$ROOT/output/wt/$task"
    # Remove the junction first so worktree removal never touches the shared node_modules.
    [[ -e "$dir/node_modules" ]] && powershell -NoProfile -Command "(Get-Item '$(cygpath -w "$dir/node_modules")').Delete()"
    git -C "$ROOT" worktree remove --force "$dir"
    git -C "$ROOT" branch -d "wt/$task"
    echo "returned $task"
    ;;
  list) git -C "$ROOT" worktree list ;;
  *) echo "unknown command $cmd"; exit 1 ;;
esac
