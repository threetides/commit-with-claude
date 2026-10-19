import * as path from "node:path";
import * as vscode from "vscode";
import { labelForModel } from "./catalog";
import { CatalogService } from "./catalogService";
import { CancelledError, ClaudeError, resetClaudePathCache, resolveClaudePath, runClaude } from "./cli";
import { readConfig, SECTION } from "./config";
import { collectDiff, currentBranch, NoChangesError, recentSubjects } from "./diff";
import { getGitApi, type GitAPI, type Repository } from "./git";
import { Logger } from "./log";
import { PanelProvider } from "./panel";
import { buildSystemPrompt, buildUserPrompt, type PromptInput } from "./prompt";
import { getStyle, parseJsonObject, validate } from "./styles";

export function activate(context: vscode.ExtensionContext): void {
  const log = new Logger();
  log.debugEnabled = readConfig().debug;
  const catalog = new CatalogService(log);
  const panel = new PanelProvider(catalog, log);

  context.subscriptions.push(
    log,
    catalog,
    vscode.window.registerWebviewViewProvider(PanelProvider.viewId, panel, { webviewOptions: { retainContextWhenHidden: true } }),
    catalog.onDidChange(() => panel.refresh()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(SECTION)) return;
      log.debugEnabled = readConfig().debug;
      if (e.affectsConfiguration(`${SECTION}.claudePath`)) resetClaudePathCache();
      panel.refresh();
    }),
  );

  let running = false;
  context.subscriptions.push(
    vscode.commands.registerCommand("claudeCommit.generate", async (arg?: unknown) => {
      if (running) {
        void vscode.window.showInformationMessage("Commit with Claude is already generating a message.");
        return;
      }
      running = true;
      try {
        await generate(arg, { log, catalog, panel });
      } finally {
        running = false;
      }
    }),
    vscode.commands.registerCommand("claudeCommit.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "@ext:threetides.claude-commit"),
    ),
    vscode.commands.registerCommand("claudeCommit.refreshModels", () => {
      const info = catalog.refresh();
      void vscode.window.showInformationMessage(`Commit with Claude: ${info.models.length} models loaded from ${info.source === "catalog" ? "Claude Code's catalog" : "the fallback list"}.`);
    }),
    vscode.commands.registerCommand("claudeCommit.showLog", () => log.show()),
  );

  log.info("Commit with Claude activated");
}

export function deactivate(): void {
  /* disposables handle cleanup */
}

interface Deps {
  log: Logger;
  catalog: CatalogService;
  panel: PanelProvider;
}

async function generate(arg: unknown, { log, catalog, panel }: Deps): Promise<void> {
  const gitApi = getGitApi();
  if (!gitApi) {
    void vscode.window.showErrorMessage("Commit with Claude: the built-in Git extension is not available.");
    return;
  }
  const repo = await pickRepository(gitApi, arg);
  if (!repo) return;

  const cwd = repo.rootUri.fsPath;
  const cfg = readConfig(repo.rootUri);
  const style = getStyle(cfg.style);
  const cat = catalog.get();
  const requestedLabel = cfg.model
    ? labelForModel(cfg.model, cat.models)
    : `Default${cat.currentModelLabel ? ` (${cat.currentModelLabel})` : ""}`;

  log.info(`Generating for ${cwd} · style ${style.id} · model ${requestedLabel} · effort ${cfg.effort}`);
  panel.setStatus("Generating…");

  try {
    const message = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Commit with Claude", cancellable: true },
      async (progress, token) => {
        progress.report({ message: "Collecting changes…" });
        const claudePath = await resolveClaudePath(cfg.claudePath);
        const diff = await collectDiff(cwd, {
          ignoreGlobs: cfg.ignoreGlobs,
          maxFileChars: cfg.maxFileDiffChars,
          maxTotalChars: cfg.maxTotalDiffChars,
        });
        log.info(
          `Diff: ${diff.staged ? "staged" : "unstaged"} · ${diff.included.length} files included · ${diff.omitted.length} summarised · ${diff.truncatedFiles} truncated · ${diff.text.length} chars`,
        );
        const [recent, branch] = await Promise.all([recentSubjects(cwd, cfg.recentCommitExamples), currentBranch(cwd)]);

        const input: PromptInput = {
          style,
          bodyMode: cfg.bodyMode,
          language: cfg.language,
          extraInstructions: cfg.extraInstructions,
          repoName: path.basename(cwd),
          branch,
          recentSubjects: recent,
          diff,
        };
        const systemPrompt = buildSystemPrompt(input);
        const prompt = buildUserPrompt(input);
        log.debug(`System prompt:\n${systemPrompt}`);
        log.debug(`Prompt:\n${prompt}`);

        progress.report({ message: `Asking ${requestedLabel}…` });
        const run = (strict: boolean) =>
          runClaude({
            claudePath,
            cwd,
            systemPrompt,
            prompt,
            effort: cfg.effort,
            model: cfg.model || undefined,
            jsonSchema: strict ? style.schema : undefined,
            timeoutMs: cfg.timeoutSeconds * 1000,
            token,
            log: (l) => log.debug(l),
          });

        let result = await run(false);
        log.debug(`Reply: ${result.text}`);
        let data = parseJsonObject(result.text);
        let errors = data ? validate(style.schema, data) : ["reply was not a JSON object"];

        if (errors.length) {
          log.info(`Reply did not match the ${style.label} schema (${errors.join("; ")}). Retrying with strict schema.`);
          progress.report({ message: "Retrying with strict schema…" });
          result = await run(true);
          log.debug(`Strict reply: ${JSON.stringify(result.structured ?? result.text)}`);
          data =
            (result.structured && typeof result.structured === "object" && !Array.isArray(result.structured)
              ? (result.structured as Record<string, unknown>)
              : undefined) ?? parseJsonObject(result.text);
          errors = data ? validate(style.schema, data) : ["reply was not a JSON object"];
          if (!data || errors.length) {
            throw new ClaudeError(`Claude's reply did not match the ${style.label} format: ${errors.join("; ")}`, result.text);
          }
        }

        const rendered = style.render(data!, { bodyMode: cfg.bodyMode });
        const modelUsed = result.model ? labelForModel(result.model, cat.models) : requestedLabel;
        log.info(`Done in ${result.durationMs} ms with ${modelUsed}${result.apiMs ? ` (API ${result.apiMs} ms)` : ""}`);
        panel.setLastRun({ model: modelUsed, styleLabel: style.label, durationMs: result.durationMs, at: Date.now() });
        return rendered;
      },
    );

    repo.inputBox.value = message;
    if (!arg) await vscode.commands.executeCommand("workbench.view.scm");
  } catch (err) {
    if (err instanceof CancelledError) {
      log.info("Cancelled by user");
      return;
    }
    if (err instanceof NoChangesError) {
      void vscode.window.showWarningMessage(`Commit with Claude: ${err.message}`);
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    log.error(msg);
    if (err instanceof ClaudeError && err.detail) log.error(err.detail);
    const action = await vscode.window.showErrorMessage(`Commit with Claude: ${msg}`, "Show Log");
    if (action === "Show Log") log.show();
  } finally {
    panel.setStatus(undefined);
  }
}

function uriFromArg(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) return arg;
  if (arg && typeof arg === "object") {
    const root = (arg as { rootUri?: unknown }).rootUri;
    if (root instanceof vscode.Uri) return root;
  }
  return undefined;
}

async function pickRepository(gitApi: GitAPI, arg: unknown): Promise<Repository | undefined> {
  const repos = gitApi.repositories;
  if (!repos.length) {
    void vscode.window.showErrorMessage("Commit with Claude: no Git repository is open.");
    return undefined;
  }
  const uri = uriFromArg(arg);
  if (uri) {
    const match = repos.find((r) => r.rootUri.toString() === uri.toString()) ?? gitApi.getRepository(uri);
    if (match) return match;
  }
  if (repos.length === 1) return repos[0];

  const active = vscode.window.activeTextEditor?.document.uri;
  if (active) {
    const match = gitApi.getRepository(active);
    if (match) return match;
  }
  const picked = await vscode.window.showQuickPick(
    repos.map((r) => ({ label: path.basename(r.rootUri.fsPath), description: r.rootUri.fsPath, repo: r })),
    { placeHolder: "Which repository?" },
  );
  return picked?.repo;
}
