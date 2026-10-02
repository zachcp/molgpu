# Worktree inventory and cleanup recommendation

Date: 2026-10-02. Baseline: `main` at `21660a4`. Bead: `molgpu-sept-s5o.16`.
Read-only: nothing was removed. Every action below needs the owner's
authorization.

## Method

For each of the 20 checkouts in `git worktree list`: uncommitted changes
(`git status --porcelain`), commits not in `main`, the branch's pull request,
and whether the branch tip is the merged PR head or an ancestor of it. Squash
merges leave branch commits outside `main`'s history, so "commits not in main"
alone does not mean unmerged work.

## Findings

| Checkout                                        | Branch                              | State                               | Committed work preserved?                                       |
| ----------------------------------------------- | ----------------------------------- | ----------------------------------- | --------------------------------------------------------------- |
| `molgpu-sept` (primary)                         | current work                        | active                              | keep                                                            |
| `~/.codex/worktrees/architecture-quality-fixes` | `codex/architecture-quality-fixes`  | clean, 2026-09-29                   | yes: ancestor of `main` (#29)                                   |
| `~/.codex/worktrees/cartoon-molstar-parity`     | `codex/cartoon-molstar-parity`      | clean, 2026-09-28                   | yes: tip is merged PR head (#26)                                |
| `~/.codex/worktrees/coordinate-stream`          | `codex/coordinate-stream`           | clean, 2026-09-26                   | yes: tip is merged PR head (#5)                                 |
| `~/.codex/worktrees/epic-start`                 | `codex/phase-9-position-guard`      | clean, 2026-09-26                   | yes: tip is merged PR head (#9)                                 |
| `~/.codex/worktrees/fix-ci-pr2`                 | `codex/fix-ci-pr2`                  | clean, 2026-09-26                   | yes: tip is merged PR head (#4)                                 |
| `~/.codex/worktrees/gpu-publication`            | `codex/status-retirement-probe`     | clean, 2026-09-29                   | yes: ancestor of `main` (no PR)                                 |
| `~/.codex/worktrees/phase-10-attributes`        | `codex/phase-10-attributes`         | clean, 2026-09-26                   | yes: tip is merged PR head (#10)                                |
| `~/.codex/worktrees/phase-14`                   | `codex/phase-14-charge`             | clean, 2026-09-27                   | yes: ancestor of merged PR head (#15)                           |
| `~/.codex/worktrees/pr8-review-fixes`           | detached `0db3bf8`                  | clean, 2026-09-26                   | yes: ancestor of `main`                                         |
| `~/.codex/worktrees/qc-beads-pr`                | `codex/qc-beads-pr`                 | clean, 2026-09-27                   | yes: ancestor of `main` (#23)                                   |
| `~/.codex/worktrees/site-beads`                 | `codex/site-beads`                  | clean, 2026-09-28                   | yes: ancestor of `main` (#25)                                   |
| `~/.codex/worktrees/site-links`                 | `codex/qc-followups`                | clean, 2026-09-28                   | yes: tip is merged PR head (#24)                                |
| `~/.codex/worktrees/trajectory-dssp-unwrap`     | `codex/gpu-dssp-followups`          | clean, 2026-09-27                   | yes: ancestor of merged PR head (#20)                           |
| `.claude/worktrees/efv`                         | `work/gpu-dssp-followups`           | clean, 2026-09-27                   | yes: tip equals merged PR #20 head                              |
| `.claude/worktrees/phase-12-trajectory`         | `work/phase-12-trajectory`          | clean, 2026-09-26                   | yes: ancestor of `main` (#8)                                    |
| `.claude/worktrees/phase-13-finish`             | `work/phase-13-finish`              | clean, 2026-09-27                   | yes: tip is merged PR head (#16)                                |
| `.claude/worktrees/phase-14-charge`             | `work/phase-14-charge`              | clean, 2026-09-27                   | yes: tip is merged PR head (#12)                                |
| `.claude/worktrees/phase-15-ss`                 | `work/phase-15-secondary-structure` | clean, 2026-09-27                   | yes: tip is merged PR head (#14)                                |
| `.claude/worktrees/agent-a4f0b15c587e3bf7a`     | `worktree-agent-a4f0b15c587e3bf7a`  | **226 modified files, uncommitted** | **no**: about 19k inserted lines on base `1f2b5f8` (2026-09-25) |

Stashes (shared by every worktree), both named and kept:

- `stash@{0}` from `codex/architecture-quality-spikes`: "pre-pull: local
  execution plan draft (2026-09-29)", 1 file.
- `stash@{1}` from `codex/qc-followups`: "WIP molgpu-sept-bxl cartoon visual
  comparison", 3 files. Belongs to the open `bxl` bead.

## Recommendation

1. **Remove the 18 clean secondary checkouts.** Their committed work is in
   `main` or in a merged PR head, which GitHub retains. Then delete their local
   branches (`-D`, because squash merges are not ancestors).
2. **Preserve, then decide, the agent worktree.** Its uncommitted diff is the
   only unrecovered work. Archive it as a patch before any removal. It predates
   most of the current architecture, so applying it to `main` would need a
   review; it is not a drop-in change.
3. **Keep both stashes.** Hand `stash@{1}` to whoever picks up `bxl`.

Commands for the owner (not run):

```sh
git -C .claude/worktrees/agent-a4f0b15c587e3bf7a diff > ~/molgpu-agent-a4f0b15c-2026-09-25.patch
git worktree remove .claude/worktrees/agent-a4f0b15c587e3bf7a --force
for w in efv phase-12-trajectory phase-13-finish phase-14-charge phase-15-ss; do git worktree remove ".claude/worktrees/$w"; done
for w in architecture-quality-fixes cartoon-molstar-parity coordinate-stream epic-start fix-ci-pr2 gpu-publication phase-10-attributes phase-14 pr8-review-fixes qc-beads-pr site-beads site-links trajectory-dssp-unwrap; do git worktree remove "$HOME/.codex/worktrees/$w/molgpu-sept"; done
git worktree prune
```
