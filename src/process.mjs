import { spawn } from "node:child_process";

export function runProcess({ command, args, cwd, timeoutSeconds, maxOutputBytes, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let timer;

    const append = (target, chunk) => {
      const text = chunk.toString("utf8");
      const remaining = Math.max(0, maxOutputBytes - outputBytes);
      const accepted = Buffer.from(text, "utf8").subarray(0, remaining).toString("utf8");
      outputBytes += Buffer.byteLength(accepted);
      if (accepted.length < text.length) truncated = true;
      if (target === "stdout") stdout += accepted;
      else stderr += accepted;
      if (truncated) child.kill();
    };

    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr, timedOut, truncated });
    });

    timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutSeconds * 1000);
  });
}
