# Security

## Reporting

Please report security issues privately to the repository owner instead of opening a public issue containing exploit details or secrets.

## Secret handling

This repository must not contain OpenAI API keys, tunnel runtime keys, GitHub tokens, private project configuration, logs, or machine-specific tunnel state. Store them outside the repository and reference them through environment variables or protected local files.

If a secret is committed, revoke it immediately and remove it from the complete Git history before making the repository public.
