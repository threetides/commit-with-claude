/**
 * Runs the `claude` CLI in print mode with the agent harness stripped down:
 * no tools, no MCP servers, our own system prompt. In testing this cut prompt
 * size 7x and API time 2.5x compared to a default invocation, and removed
 * thinking tokens entirely.
 */
import { execFile, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { JsonSchema } from "./styles";

export interface CancelToken {
  isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

export interface RunOptions {
  claudePath: string;
  cwd: string;
  systemPrompt: string;
  prompt: string;
  effort: string;
  model?: string;
  jsonSchema?: JsonSchema;
  timeoutMs: number;
  token?: CancelToken;
  log?: (line: string) => void;
}

export interface RunResult {
  text: string;
  structured?: unknown;
  model?: string;
  durationMs: number;
  apiMs?: number;
  costUsd?: number;
}

export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CancelledError";
  }
}

export class ClaudeError extends Error {
  constructor(message: string, public readonly detail?: string) {
    super(message);
    this.name = "ClaudeError";
  }
}

// ---------- locating the binary ----------

let cachedPath: string | undefined;

export function resetClaudePathCache(): void {
  cachedPath = undefined;
}

async function isExecutable(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p, fs.constants.X_OK);
    return (await fs.promises.stat(p)).isFile();
  } catch {
    return false;
  }
}

function shellLookup(): Promise<string | undefined> {
  const shell = process.env.SHELL || "/bin/zsh";
  return new Promise((resolve) => {
    execFile(shell, ["-lc", "command -v claude"], { timeout: 8000 }, (err, stdout) => {
      if (err) return resolve(undefined);
      const p = stdout.trim().split("\n").pop()?.trim();
      resolve(p || undefined);
    });
  });
}

export async function resolveClaudePath(customPath: string | undefined): Promise<string> {
  if (customPath && customPath.trim()) {
    const p = customPath.trim().replace(/^~(?=\/|$)/, os.homedir());
    if (await isExecutable(p)) return p;
    throw new ClaudeError(`The configured claude path is not executable: ${p}`);
  }
  if (cachedPath && (await isExecutable(cachedPath))) return cachedPath;

  const home = os.homedir();
  const candidates = [
    path.join(home, ".local", "bin", "claude"),
    path.join(home, ".claude", "local", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((d) => path.join(d, "claude")),
  ];
  for (const c of candidates) {
    if (await isExecutable(c)) return (cachedPath = c);
  }
  const fromShell = await shellLookup();
  if (fromShell && (await isExecutable(fromShell))) return (cachedPath = fromShell);

  throw new ClaudeError(
    "Could not find the claude executable. Install Claude Code, or set claudeCommit.claudePath to its location.",
  );
}

// ---------- running ----------

function pickModel(modelUsage: unknown, requested?: string): string | undefined {
  const usage = modelUsage && typeof modelUsage === "object" ? (modelUsage as Record<string, { outputTokens?: number }>) : undefined;
  if (!usage) return requested;
  const keys = Object.keys(usage);
  if (requested) {
    const exact = keys.find((k) => k === requested || k.startsWith(requested));
    if (exact) return exact;
  }
  // Claude Code makes a small side call to Haiku for bookkeeping; the main model has the most output.
  let best: string | undefined;
  let bestOut = -1;
  for (const k of keys) {
    const out = usage[k]?.outputTokens ?? 0;
    if (out > bestOut) {
      bestOut = out;
      best = k;
    }
  }
  return best ?? requested;
}

export function runClaude(opts: RunOptions): Promise<RunResult> {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--no-session-persistence",
    "--tools",
    "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--effort",
    opts.effort,
    "--system-prompt",
    opts.systemPrompt,
  ];
  if (opts.model) args.push("--model", opts.model);
  if (opts.jsonSchema) args.push("--json-schema", JSON.stringify(opts.jsonSchema));

  opts.log?.(`claude ${args.map((a) => (a === opts.systemPrompt ? "<system prompt>" : a.startsWith("{") ? "<schema>" : a === "" ? '""' : a)).join(" ")}`);

  return new Promise<RunResult>((resolve, reject) => {
    if (opts.token?.isCancellationRequested) return reject(new CancelledError());
    const started = Date.now();
    const child = spawn(opts.claudePath, args, { cwd: opts.cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let cancelled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub?.dispose();
      fn();
    };

    const kill = () => {
      try {
        child.kill("SIGTERM");
        setTimeout(() => {
          try {
            if (child.exitCode === null) child.kill("SIGKILL");
          } catch {
            /* ignore */
          }
        }, 2000).unref();
      } catch {
        /* ignore */
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs);

    const sub = opts.token?.onCancellationRequested(() => {
      cancelled = true;
      kill();
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (stdout += d));
    child.stderr.on("data", (d: string) => (stderr += d));

    child.on("error", (err) => finish(() => reject(new ClaudeError(`Failed to start claude: ${err.message}`))));

    child.on("close", (code) => {
      finish(() => {
        if (cancelled) return reject(new CancelledError());
        if (timedOut) return reject(new ClaudeError(`Claude did not answer within ${Math.round(opts.timeoutMs / 1000)} seconds.`, stderr));

        const durationMs = Date.now() - started;
        const parsed = parseCliJson(stdout);
        if (!parsed) {
          const detail = (stderr || stdout).trim();
          return reject(new ClaudeError(code === 0 ? "Claude returned no parseable output." : `Claude exited with code ${code}.`, detail));
        }
        if (parsed.is_error === true || parsed.subtype === "error_during_execution" || (typeof parsed.subtype === "string" && parsed.subtype.startsWith("error"))) {
          const msg = typeof parsed.result === "string" && parsed.result.trim() ? parsed.result.trim() : "Claude reported an error.";
          return reject(new ClaudeError(msg, stderr || JSON.stringify(parsed).slice(0, 2000)));
        }
        resolve({
          text: typeof parsed.result === "string" ? parsed.result : "",
          structured: parsed.structured_output ?? undefined,
          model: pickModel(parsed.modelUsage, opts.model),
          durationMs,
          apiMs: typeof parsed.duration_api_ms === "number" ? parsed.duration_api_ms : undefined,
          costUsd: typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : undefined,
        });
      });
    });

    child.stdin.on("error", () => {
      /* EPIPE if claude exits early; the close handler reports the real error */
    });
    child.stdin.end(opts.prompt);
  });
}

function parseCliJson(stdout: string): Record<string, unknown> | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  const tryParse = (s: string): Record<string, unknown> | undefined => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  };
  return (
    tryParse(trimmed) ??
    // the CLI may print a warning line before the JSON; take the last line that parses
    trimmed
      .split("\n")
      .reverse()
      .map((l) => tryParse(l.trim()))
      .find((v) => v !== undefined)
  );
}
