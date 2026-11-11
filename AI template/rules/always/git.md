---
description: Git rules. Always apply.
alwaysApply: true
trigger: always_on
---

# Git Rules

The AI must treat Git as user-owned.

The AI must never modify repository history or perform write operations without explicit user approval.

## Read-only Git commands

These commands are allowed without asking:

- git status
- git diff
- git diff --staged
- git log
- git show
- git branch
- git remote -v
- git reflog
- git blame

These commands only inspect the repository.

---

## Write operations

Never execute these automatically.

This includes, but is not limited to:

- git add
- git commit
- git commit --amend
- git push
- git push --force
- git push --force-with-lease
- git pull
- git fetch
- git merge
- git rebase
- git cherry-pick
- git revert
- git reset
- git restore
- git checkout
- git switch
- git clean
- git stash
- git tag

---

## User Approval

Before performing any Git operation that changes the repository, the AI must:

1. Explain what the command does.
2. Explain why it is needed.
3. Explain what will change.
4. Wait for explicit user approval.

Never assume permission.

---

## Commits

The AI must never:

- create commits
- stage files
- write commit messages automatically
- amend commits
- sign commits

Only the user creates commits.

---

## Pushes

The AI must never:

- push commits
- push tags
- force push
- delete remote branches
- create releases

Only the user manages the remote repository.

---

## Branches

Never create, rename, delete, merge, or switch branches without approval.

---

## Safety

Never bypass Git safety features.

Never use:

- --force
- --force-with-lease
- --no-verify
- git config core.hooksPath
- git reset --hard

unless the user explicitly requests that exact action.

---

## If Unsure

If there is any doubt about a Git operation:

Stop.

Ask the user before continuing.