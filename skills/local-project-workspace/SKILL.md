---
name: local-project-workspace
description: Discover approved Git and non-Git projects and safely inspect, edit, test, and use guarded Git delivery when available through Secure Local Workspace MCP tools.
---

# Secure Local Workspace MCP

Use the MCP tools to work only with project IDs returned by `list_projects`.

## Workflow

1. Call `diagnostics`, then `list_projects`. If the requested project is not authorized, call `discover_projects`; connect it only when it is beneath a locally approved discovery root. Non-Git projects are supported with commit and push forced off.
2. Use `list_files`, `search_text`, and `read_file` to inspect the smallest relevant scope.
3. Before editing an existing file, call `read_file` again and pass its current `sha256` to `apply_patch`. Use `create_text_file` only for a new path.
4. Preserve unrelated changes. After writing to a Git project, call `git_diff` and `git_status`. For a non-Git project, do not call Git tools; instead report the explicit files changed.
5. Run only task names returned for that project. Report the exact task and exit code.
6. Commit only when the user requests it, `projectType` is `git`, and the project reports `allowCommit: true`. Pass only explicit relative paths and the latest `statusSha256` to `git_commit`. Never mix unrelated or pre-staged changes.
7. Treat commit and push as separate states. Call `git_push` only when the user explicitly requests a push and the project reports `allowPush: true`.

The server deliberately provides no arbitrary shell, force-push, history rewrite, broad staging, or deployment tool. Never imply that a commit or push occurred unless the corresponding tool succeeded.
