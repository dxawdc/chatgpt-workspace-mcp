# Security

## Reporting

Please report security issues privately to the repository owner instead of opening a public issue containing exploit details or secrets.

## Secret handling

This repository must not contain OpenAI API keys, tunnel runtime keys, GitHub tokens, private project configuration, logs, or machine-specific tunnel state. Store them outside the repository and reference them through environment variables or protected local files.

If a secret is committed, revoke it immediately and remove it from the complete Git history before making the repository public.

The guarded commit tool rejects common secret-bearing paths and high-confidence key patterns, but this scan is intentionally conservative and cannot prove that a commit is secret-free. Always review the staged diff and use a dedicated secret scanner for high-risk repositories.

## Authorization boundaries

- Project discovery is limited to parent folders approved in the local configuration.
- Common non-Git project folders may be discovered, and any explicit directory beneath an approved root may be connected; non-Git projects always have commit and push disabled.
- Do not configure a disk root, a user home directory, or another broad private folder as a discovery root.
- Commit and push permissions are separate and disabled by schema defaults.
- Push is restricted to configured remotes and optional branches and never uses force.
- MCP-created commits use a temporary empty `core.hooksPath`, so repository hooks do not execute. Run validation through explicit allowlisted tasks instead.
