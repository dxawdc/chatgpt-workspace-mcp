import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runProcess } from "./process.mjs";

const MAX_COMMIT_MESSAGE_BYTES = 4096;
const MAX_SECRET_SCAN_BYTES = 2 * 1024 * 1024;

const SECRET_PATTERNS = [
  ["OpenAI-style API key", /sk-[A-Za-z0-9_-]{20,}/],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{20,}/],
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["Tunnel identifier", /tunnel_[A-Za-z0-9]{16,}/],
  ["OpenAI organization identifier", /org-[A-Za-z0-9]{12,}/],
];

const DENIED_FILE_NAMES = new Set([
  "id_rsa",
  "id_ed25519",
  "credentials.json",
  "service-account.json",
]);

const DENIED_EXTENSIONS = new Set([".key", ".pem", ".p12", ".pfx", ".kdbx"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sanitizeGitOutput(value) {
  return String(value || "")
    .replace(/https:\/\/[^\s/@:]+:[^\s/@]+@/gi, "https://***@")
    .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED_API_KEY]");
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function normalizePathSpec(root, value) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || path.isAbsolute(value)) {
    throw new Error("Commit paths must be non-empty relative paths.");
  }
  const absolute = path.resolve(root, value);
  if (!isInside(root, absolute) || absolute === root) {
    throw new Error(`Commit path is outside the project or too broad: ${value}`);
  }
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  if (relative.split("/").includes(".git")) throw new Error("The .git directory cannot be staged.");
  return relative;
}

function validateCommitMessage(message) {
  if (typeof message !== "string" || !message.trim() || message.includes("\0")) {
    throw new Error("Commit message must be a non-empty string without NUL characters.");
  }
  if (Buffer.byteLength(message, "utf8") > MAX_COMMIT_MESSAGE_BYTES) {
    throw new Error(`Commit message is larger than ${MAX_COMMIT_MESSAGE_BYTES} bytes.`);
  }
  return message.trim();
}

function assertPathIsNotSensitive(relativePath) {
  const lower = relativePath.toLowerCase();
  const name = path.posix.basename(lower);
  const extension = path.posix.extname(lower);
  if ((name === ".env" || name.startsWith(".env.")) && ![".env.example", ".env.sample", ".env.template"].includes(name)) {
    throw new Error(`Refusing to commit environment file: ${relativePath}`);
  }
  if (DENIED_FILE_NAMES.has(name) || DENIED_EXTENSIONS.has(extension)) {
    throw new Error(`Refusing to commit sensitive file type: ${relativePath}`);
  }
}

async function assertPathIsFileOrMissing(root, relativePath) {
  try {
    const stat = await fs.lstat(path.join(root, relativePath));
    if (stat.isDirectory()) throw new Error(`Commit paths must name files, not directories: ${relativePath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function runGit(
  root,
  args,
  { timeoutSeconds = 60, maxOutputBytes = 1024 * 1024, allowFailure = false, sanitize = true } = {},
) {
  const result = await runProcess({
    command: "git",
    args,
    cwd: root,
    timeoutSeconds,
    maxOutputBytes,
  });
  const rawStdout = result.stdout;
  const rawStderr = result.stderr;
  if (sanitize) {
    result.stdout = sanitizeGitOutput(rawStdout);
    result.stderr = sanitizeGitOutput(rawStderr);
  }
  if (!allowFailure && result.exitCode !== 0) {
    const detail = sanitizeGitOutput(rawStderr || rawStdout || `exit code ${result.exitCode}`).trim().slice(0, 2000);
    throw new Error(`Git command failed: ${detail}`);
  }
  return result;
}

async function currentBranch(root) {
  const result = await runGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], { allowFailure: true });
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

async function currentHead(root) {
  const result = await runGit(root, ["rev-parse", "--verify", "HEAD"], { allowFailure: true });
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

async function ensureGitRepository(root) {
  const result = await runGit(root, ["rev-parse", "--is-inside-work-tree"], { allowFailure: true });
  if (result.exitCode !== 0 || result.stdout.trim() !== "true") {
    throw new Error("The authorized project is not a Git working tree.");
  }
}

async function stagedPaths(root) {
  const result = await runGit(root, ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACDMRTUXB"]);
  return result.stdout.split("\0").filter(Boolean);
}

async function scanStagedFile(root, relativePath) {
  assertPathIsNotSensitive(relativePath);
  const sizeResult = await runGit(root, ["cat-file", "-s", `:${relativePath}`], { allowFailure: true });
  if (sizeResult.exitCode !== 0) return;
  const size = Number.parseInt(sizeResult.stdout.trim(), 10);
  if (!Number.isSafeInteger(size)) throw new Error(`Could not determine staged file size: ${relativePath}`);
  if (size > MAX_SECRET_SCAN_BYTES) {
    throw new Error(`Refusing to commit an unscanned file larger than ${MAX_SECRET_SCAN_BYTES} bytes: ${relativePath}`);
  }
  const contentResult = await runGit(root, ["show", `:${relativePath}`], {
    maxOutputBytes: MAX_SECRET_SCAN_BYTES + 1,
    sanitize: false,
  });
  if (contentResult.truncated) throw new Error(`Secret scan output was truncated: ${relativePath}`);
  for (const [label, pattern] of SECRET_PATTERNS) {
    if (pattern.test(contentResult.stdout)) {
      throw new Error(`Sensitive-content scan detected ${label} in ${relativePath}. Nothing was committed.`);
    }
  }
}

async function unstagePaths(root, paths, headExists) {
  if (headExists) {
    await runGit(root, ["reset", "--quiet", "HEAD", "--", ...paths], { allowFailure: true });
  } else {
    await runGit(root, ["rm", "--cached", "--quiet", "--ignore-unmatch", "--", ...paths], { allowFailure: true });
  }
}

export async function gitStatusSnapshot(root, maxOutputBytes) {
  await ensureGitRepository(root);
  const [display, porcelain, branch, head] = await Promise.all([
    runGit(root, ["status", "--short", "--branch"], { maxOutputBytes }),
    runGit(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { maxOutputBytes }),
    currentBranch(root),
    currentHead(root),
  ]);
  return {
    exitCode: display.exitCode,
    stdout: display.stdout,
    stderr: display.stderr,
    branch,
    head,
    statusSha256: sha256(`${branch || ""}\0${head || ""}\0${porcelain.stdout}`),
    clean: porcelain.stdout.length === 0,
    stagedPaths: await stagedPaths(root),
  };
}

export async function gitDiffSnapshot(root, staged, maxOutputBytes) {
  await ensureGitRepository(root);
  const args = ["diff", "--no-ext-diff", "--no-color"];
  if (staged) args.push("--cached");
  const output = await runGit(root, args, { maxOutputBytes });
  return { ...output, staged, diffSha256: sha256(output.stdout), empty: output.stdout.length === 0 };
}

export async function gitUnstage({ root, paths, expectedStatusSha256, maxOutputBytes }) {
  const before = await gitStatusSnapshot(root, maxOutputBytes);
  if (before.statusSha256 !== expectedStatusSha256) {
    throw new Error("Git status changed since it was reviewed. Call git_status again.");
  }
  const normalized = [...new Set(paths.map((value) => normalizePathSpec(root, value)))];
  if (!normalized.length) throw new Error("At least one path is required.");
  await unstagePaths(root, normalized, Boolean(before.head));
  return gitStatusSnapshot(root, maxOutputBytes);
}

export async function gitCommit({ root, paths, message, expectedStatusSha256, maxOutputBytes }) {
  const safeMessage = validateCommitMessage(message);
  const normalized = [...new Set(paths.map((value) => normalizePathSpec(root, value)))];
  if (!normalized.length) throw new Error("At least one explicit commit path is required.");
  for (const relativePath of normalized) {
    assertPathIsNotSensitive(relativePath);
    await assertPathIsFileOrMissing(root, relativePath);
  }

  const before = await gitStatusSnapshot(root, maxOutputBytes);
  if (before.statusSha256 !== expectedStatusSha256) {
    throw new Error("Git status changed since it was reviewed. Call git_status and git_diff again.");
  }
  if (before.stagedPaths.length) {
    throw new Error(`Refusing to mix with pre-existing staged changes: ${before.stagedPaths.join(", ")}`);
  }

  await runGit(root, ["add", "--", ...normalized], { maxOutputBytes });
  let committed = false;
  try {
    const staged = await stagedPaths(root);
    if (!staged.length) throw new Error("The selected paths contain no changes to commit.");
    for (const relativePath of staged) await scanStagedFile(root, relativePath);
    const check = await runGit(root, ["diff", "--cached", "--check"], { maxOutputBytes, allowFailure: true });
    if (check.exitCode !== 0) {
      throw new Error(`Git whitespace check failed: ${(check.stdout || check.stderr).trim().slice(0, 2000)}`);
    }
    const emptyHooksDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "secure-workspace-no-hooks-"));
    let commit;
    try {
      commit = await runGit(root, ["-c", `core.hooksPath=${emptyHooksDirectory}`, "commit", "-m", safeMessage], {
        timeoutSeconds: 180,
        maxOutputBytes,
      });
    } finally {
      await fs.rm(emptyHooksDirectory, { recursive: true, force: true });
    }
    committed = true;
    const head = await currentHead(root);
    const branch = await currentBranch(root);
    return {
      committed: true,
      commitSha: head,
      branch,
      paths: staged,
      summary: commit.stdout.trim(),
      pushPerformed: false,
    };
  } finally {
    if (!committed) await unstagePaths(root, normalized, Boolean(before.head));
  }
}

export async function gitPush({
  root,
  remote,
  expectedCommitSha,
  allowedRemotes,
  allowedBranches,
  maxOutputBytes,
}) {
  await ensureGitRepository(root);
  if (!allowedRemotes.includes(remote)) throw new Error(`Remote is not allowed: ${remote}`);
  const [head, branch] = await Promise.all([currentHead(root), currentBranch(root)]);
  if (!head || !branch) throw new Error("Cannot push an unborn or detached HEAD.");
  if (head !== expectedCommitSha) throw new Error("HEAD changed since the commit was reviewed. Call git_status again.");
  if (allowedBranches.length && !allowedBranches.includes(branch)) {
    throw new Error(`Branch is not allowed for push: ${branch}`);
  }
  const output = await runGit(root, ["push", "--porcelain", remote, `HEAD:refs/heads/${branch}`], {
    timeoutSeconds: 180,
    maxOutputBytes,
  });
  return {
    pushed: true,
    remote,
    branch,
    commitSha: head,
    summary: (output.stdout || output.stderr).trim(),
  };
}

export async function isGitProjectRoot(candidate) {
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isDirectory()) return false;
    const result = await runGit(candidate, ["rev-parse", "--show-toplevel"], { allowFailure: true });
    if (result.exitCode !== 0) return false;
    const detectedRoot = path.resolve(result.stdout.trim());
    const expectedRoot = path.resolve(candidate);
    return process.platform === "win32"
      ? detectedRoot.toLowerCase() === expectedRoot.toLowerCase()
      : detectedRoot === expectedRoot;
  } catch {
    return false;
  }
}
