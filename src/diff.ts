/**
 * Collects the diff to describe: staged changes, or if nothing is staged, unstaged
 * plus untracked files. Noise is replaced by one-line summaries so the model still
 * knows a lockfile changed without reading 400 lines of it.
 */
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { BUILTIN_IGNORE_GLOBS, matchesAny } from "./glob";

export interface DiffOptions {
  ignoreGlobs: string[];
  maxFileChars: number;
  maxTotalChars: number;
}

export interface OmittedFile {
  path: string;
  reason: string;
  added?: number;
  deleted?: number;
}

export interface DiffResult {
  /** Diff text with stubs for omitted files, ready for the prompt. */
  text: string;
  staged: boolean;
  included: string[];
  omitted: OmittedFile[];
  truncatedFiles: number;
}

export class NoChangesError extends Error {
  constructor() {
    super("No changes to describe. Stage or edit some files first.");
    this.name = "NoChangesError";
  }
}

export function git(cwd: string, args: string[], okExitCodes: number[] = [0]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException & { code?: number | string }).code;
        if (typeof code === "number" && okExitCodes.includes(code)) return resolve(stdout);
        return reject(new Error(`git ${args[0]} failed: ${(stderr || err.message).trim()}`));
      }
      resolve(stdout);
    });
  });
}

function splitZ(out: string): string[] {
  return out.split("\0").filter(Boolean);
}

export async function recentSubjects(cwd: string, count: number): Promise<string[]> {
  if (count <= 0) return [];
  try {
    const out = await git(cwd, ["log", `-n${count}`, "--no-merges", "--format=%s"]);
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return []; // no commits yet
  }
}

export async function currentBranch(cwd: string): Promise<string | undefined> {
  try {
    const b = (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    return b && b !== "HEAD" ? b : undefined;
  } catch {
    return undefined;
  }
}

/** Reads `linguist-generated` and `diff` attributes for the given files. */
async function readAttributes(cwd: string, files: string[]): Promise<Map<string, { generated: boolean; noDiff: boolean }>> {
  const map = new Map<string, { generated: boolean; noDiff: boolean }>();
  if (!files.length) return map;
  try {
    const out = await git(cwd, ["check-attr", "-z", "linguist-generated", "diff", "--", ...files]);
    const parts = out.split("\0");
    for (let i = 0; i + 2 < parts.length; i += 3) {
      const [file, attr, value] = [parts[i], parts[i + 1], parts[i + 2]];
      const cur = map.get(file) ?? { generated: false, noDiff: false };
      if (attr === "linguist-generated" && (value === "true" || value === "set")) cur.generated = true;
      if (attr === "diff" && value === "unset") cur.noDiff = true;
      map.set(file, cur);
    }
  } catch {
    /* attributes are best effort */
  }
  return map;
}

interface Chunk {
  path: string;
  text: string;
}

/** Split unified diff output into per-file chunks. */
function splitChunks(diff: string): Chunk[] {
  const chunks: Chunk[] = [];
  const re = /^diff --git (.*)$/gm;
  const starts: { index: number; header: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(diff))) starts.push({ index: m.index, header: m[1] });
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].index : diff.length;
    const text = diff.slice(starts[i].index, end).replace(/\n+$/, "");
    chunks.push({ path: pathFromHeader(starts[i].header), text });
  }
  return chunks;
}

function pathFromHeader(header: string): string {
  // header is `a/<old> b/<new>`; paths with special characters are quoted
  const idx = header.lastIndexOf(" b/");
  let p = idx >= 0 ? header.slice(idx + 3) : header;
  if (p.startsWith('"') && p.endsWith('"')) {
    try {
      p = JSON.parse(p);
    } catch {
      p = p.slice(1, -1);
    }
  }
  return p;
}

function truncateChunk(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const head = text.slice(0, max);
  const cut = head.lastIndexOf("\n");
  const kept = cut > 0 ? head.slice(0, cut) : head;
  const remainingLines = text.slice(kept.length).split("\n").length - 1;
  return { text: `${kept}\n[... truncated: ${remainingLines} more lines of this file ...]`, truncated: true };
}

async function numstat(cwd: string, staged: boolean, files: string[]): Promise<Map<string, { added?: number; deleted?: number }>> {
  const map = new Map<string, { added?: number; deleted?: number }>();
  if (!files.length) return map;
  try {
    const args = ["diff", ...(staged ? ["--cached"] : []), "--numstat", "-z", "--", ...files];
    const out = await git(cwd, args);
    // numstat -z: "added\tdeleted\tpath\0" (renames use a different layout; we only need counts)
    for (const entry of splitZ(out)) {
      const [a, d, p] = entry.split("\t");
      if (p) map.set(p, { added: a === "-" ? undefined : Number(a), deleted: d === "-" ? undefined : Number(d) });
    }
  } catch {
    /* best effort */
  }
  return map;
}

async function countLines(file: string): Promise<number | undefined> {
  try {
    const stat = await fs.promises.stat(file);
    if (stat.size > 20 * 1024 * 1024) return undefined;
    const buf = await fs.promises.readFile(file);
    if (buf.includes(0)) return undefined; // binary
    let n = 0;
    for (const b of buf) if (b === 10) n++;
    return n + (buf.length && buf[buf.length - 1] !== 10 ? 1 : 0);
  } catch {
    return undefined;
  }
}

function stub(o: OmittedFile): string {
  const counts = o.added !== undefined || o.deleted !== undefined ? ` +${o.added ?? "?"} -${o.deleted ?? "?"} lines` : "";
  return `### ${o.path}:${counts} (content omitted: ${o.reason})`;
}

export async function collectDiff(cwd: string, opts: DiffOptions): Promise<DiffResult> {
  let staged = true;
  let tracked = splitZ(await git(cwd, ["diff", "--cached", "--name-only", "-z"]));
  let untracked: string[] = [];
  if (!tracked.length) {
    staged = false;
    tracked = splitZ(await git(cwd, ["diff", "--name-only", "-z"]));
    untracked = splitZ(await git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]));
  }
  const all = [...tracked, ...untracked];
  if (!all.length) throw new NoChangesError();

  const attrs = await readAttributes(cwd, all);
  const reasonFor = (p: string): string | undefined => {
    if (opts.ignoreGlobs.length && matchesAny(p, opts.ignoreGlobs)) return "matches commitWithClaude.ignoreGlobs";
    if (matchesAny(p, BUILTIN_IGNORE_GLOBS)) return "lockfile or generated file";
    const a = attrs.get(p);
    if (a?.generated) return "marked linguist-generated in .gitattributes";
    if (a?.noDiff) return "marked -diff in .gitattributes";
    return undefined;
  };

  const omitted: OmittedFile[] = [];
  const keep = new Set<string>();
  for (const p of all) {
    const r = reasonFor(p);
    if (r) omitted.push({ path: p, reason: r });
    else keep.add(p);
  }

  // Gather chunks
  let chunks: Chunk[] = [];
  const trackedKept = tracked.filter((p) => keep.has(p));
  if (trackedKept.length) {
    const args = ["diff", ...(staged ? ["--cached"] : []), "-M", "--no-color", "--no-ext-diff", "--", ...trackedKept];
    chunks = splitChunks(await git(cwd, args));
  }
  for (const p of untracked.filter((u) => keep.has(u))) {
    const out = await git(cwd, ["diff", "--no-index", "--no-color", "--", "/dev/null", p], [0, 1]);
    const parsed = splitChunks(out);
    chunks.push({ path: p, text: parsed[0]?.text ?? `diff --git a/${p} b/${p}\nnew file\n(binary or empty)` });
  }

  // Assemble with limits
  const parts: string[] = [];
  const included: string[] = [];
  let total = 0;
  let truncatedFiles = 0;
  for (const c of chunks) {
    const t = truncateChunk(c.text, opts.maxFileChars);
    if (t.truncated) truncatedFiles++;
    if (total + t.text.length > opts.maxTotalChars && included.length > 0) {
      omitted.push({ path: c.path, reason: "total diff size limit reached" });
      continue;
    }
    parts.push(t.text);
    included.push(c.path);
    total += t.text.length;
  }

  // Counts for stubs
  const omittedTracked = omitted.filter((o) => tracked.includes(o.path)).map((o) => o.path);
  const stats = await numstat(cwd, staged, omittedTracked);
  for (const o of omitted) {
    const s = stats.get(o.path);
    if (s) Object.assign(o, s);
    else if (untracked.includes(o.path)) o.added = await countLines(path.join(cwd, o.path));
  }

  const text = [...parts, ...(omitted.length ? ["", "Files changed but not shown in full:", ...omitted.map(stub)] : [])].join("\n");
  return { text, staged, included, omitted, truncatedFiles };
}
