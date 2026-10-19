/**
 * Reads Claude Code's local model catalog cache so the dropdown shows exactly the
 * models the `/model` picker offers, and so "Default" can name the model Claude Code
 * is currently set to. This is an undocumented internal cache; everything here is
 * defensive and falls back to the CLI's documented aliases.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface ModelOption {
  id: string;
  label: string;
  description?: string;
  section: "main" | "overflow";
}

export interface CatalogInfo {
  models: ModelOption[];
  /** Model Claude Code is currently set to, if known. */
  currentModelId?: string;
  currentModelLabel?: string;
  source: "catalog" | "fallback";
  fetchedAt?: number;
  note?: string;
}

export const FALLBACK_MODELS: ModelOption[] = [
  { id: "opus", label: "Opus", description: "Latest Opus", section: "main" },
  { id: "sonnet", label: "Sonnet", description: "Latest Sonnet", section: "main" },
  { id: "haiku", label: "Haiku", description: "Latest Haiku", section: "main" },
];

export function catalogDir(): string {
  return path.join(os.homedir(), ".claude", "cache", "model-catalog");
}

interface RawModel {
  id?: unknown;
  name?: unknown;
  short_name?: unknown;
  description?: unknown;
  section?: unknown;
  confidential?: unknown;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

export function labelForModel(id: string, models: ModelOption[]): string {
  const found = models.find((m) => m.id === id || id.startsWith(m.id));
  if (found) return found.label;
  // claude-opus-5-5 -> Opus 5.5
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? "." + m[3] : ""}`;
  return id;
}

export function readCatalog(): CatalogInfo {
  const dir = catalogDir();
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "masked-ids.json");
  } catch {
    return { models: FALLBACK_MODELS, source: "fallback", note: "Claude Code's model catalog cache was not found. Showing the CLI's documented aliases." };
  }

  const masked = new Set<string>();
  const maskedRaw = asRecord(readJson(path.join(dir, "masked-ids.json")));
  if (Array.isArray(maskedRaw?.ids)) for (const id of maskedRaw.ids) if (typeof id === "string") masked.add(id);

  let best: { fetchedAt: number; catalog: Record<string, unknown> } | undefined;
  for (const f of files) {
    const doc = asRecord(readJson(path.join(dir, f)));
    const catalog = asRecord(doc?.catalog);
    if (!catalog) continue;
    const fetchedAt = typeof doc?.fetchedAt === "number" ? doc.fetchedAt : 0;
    if (!best || fetchedAt > best.fetchedAt) best = { fetchedAt, catalog };
  }
  if (!best) {
    return { models: FALLBACK_MODELS, source: "fallback", note: "Claude Code's model catalog could not be parsed. Showing the CLI's documented aliases." };
  }

  const config = asRecord(best.catalog.config);
  const state = asRecord(best.catalog.state);
  const rawModels = Array.isArray(config?.models) ? (config.models as RawModel[]) : [];

  const all: (ModelOption & { confidential: boolean })[] = [];
  for (const r of rawModels) {
    if (typeof r.id !== "string") continue;
    all.push({
      id: r.id,
      label: typeof r.name === "string" ? r.name : typeof r.short_name === "string" ? r.short_name : r.id,
      description: typeof r.description === "string" ? r.description : undefined,
      section: r.section === "overflow" ? "overflow" : "main",
      confidential: r.confidential === true,
    });
  }

  const visible = all.filter((m) => !m.confidential && !masked.has(m.id));
  const models: ModelOption[] = [
    ...visible.filter((m) => m.section === "main"),
    ...visible.filter((m) => m.section === "overflow"),
  ].map(({ confidential: _c, ...m }) => m);

  const currentModelId = typeof state?.model === "string" ? state.model : undefined;
  const currentModelLabel = currentModelId
    ? labelForModel(currentModelId, all)
    : undefined;

  if (models.length === 0) {
    return { models: FALLBACK_MODELS, source: "fallback", currentModelId, currentModelLabel, fetchedAt: best.fetchedAt, note: "The catalog listed no selectable models. Showing the CLI's documented aliases." };
  }
  return { models, currentModelId, currentModelLabel, source: "catalog", fetchedAt: best.fetchedAt };
}
