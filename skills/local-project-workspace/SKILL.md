---
name: local-project-workspace
description: Safely inspect, edit, test, and review explicitly authorized local project folders through the Local Project Workspace MCP tools.
---

# Local Project Workspace

Use the MCP tools to work only with project IDs returned by `list_projects`.

## Workflow

1. Call `diagnostics`, then `list_projects`. If no project is authorized, report the configuration path and stop.
2. Use `list_files`, `search_text`, and `read_file` to inspect the smallest relevant scope.
3. Before editing an existing file, call `read_file` again and pass its current `sha256` to `apply_patch`. Use `create_text_file` only for a new path.
4. Preserve unrelated changes. After writing, call `git_diff` and, when relevant, `git_status`.
5. Run only task names returned for that project. Report the exact task and exit code.

The server deliberately provides no arbitrary shell, deletion, commit, push, or deployment tool. Do not imply that any of those actions occurred.
