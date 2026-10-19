import * as vscode from "vscode";
import type { CatalogService } from "./catalogService";
import { readConfig, settingSource, updateSetting } from "./config";
import type { Logger } from "./log";
import { STYLES } from "./styles";

export interface LastRun {
  model: string;
  styleLabel: string;
  durationMs: number;
  at: number;
}

export class PanelProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "claudeCommit.panel";
  private view?: vscode.WebviewView;
  private lastRun?: LastRun;
  private status?: string;

  constructor(
    private readonly catalog: CatalogService,
    private readonly log: Logger,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = html(view.webview.cspSource);
    view.webview.onDidReceiveMessage((msg: { type: string; value?: string }) => void this.onMessage(msg));
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
  }

  refresh(): void {
    void this.view?.webview.postMessage({ type: "state", ...this.state() });
  }

  setLastRun(run: LastRun): void {
    this.lastRun = run;
    this.refresh();
  }

  setStatus(status: string | undefined): void {
    this.status = status;
    this.refresh();
  }

  private state() {
    const cfg = readConfig();
    const cat = this.catalog.get();
    return {
      styles: STYLES.map((s) => ({ id: s.id, label: s.label, help: s.help })),
      style: cfg.style,
      styleSource: settingSource("style"),
      models: cat.models,
      model: cfg.model,
      defaultLabel: cat.currentModelLabel,
      catalogSource: cat.source,
      catalogNote: cat.note,
      lastRun: this.lastRun,
      status: this.status,
    };
  }

  private async onMessage(msg: { type: string; value?: string }): Promise<void> {
    switch (msg.type) {
      case "ready":
        this.refresh();
        break;
      case "setStyle": {
        const target = await updateSetting("style", msg.value);
        this.log.info(`Style set to ${msg.value} (${target} settings)`);
        break;
      }
      case "setModel": {
        await updateSetting("model", msg.value ?? "");
        this.log.info(`Model set to ${msg.value || "Default"}`);
        break;
      }
      case "generate":
        await vscode.commands.executeCommand("claudeCommit.generate");
        break;
      case "openSettings":
        await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:threetides.claude-commit");
        break;
      case "refreshModels":
        this.catalog.refresh();
        break;
    }
  }
}

function nonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function html(cspSource: string): string {
  const n = nonce();
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${n}'; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${n}">
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 12px 16px 16px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); }
  section { margin-bottom: 18px; }
  label { display: block; font-weight: 600; margin-bottom: 6px; }
  select { width: 100%; box-sizing: border-box; padding: 4px 6px; border-radius: 2px;
    background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border, transparent); font: inherit; }
  select:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .help { margin: 8px 0 0; color: var(--vscode-descriptionForeground); line-height: 1.45; }
  .note { margin: 6px 0 0; color: var(--vscode-descriptionForeground); font-style: italic; line-height: 1.4; }
  .note:empty, .help:empty { display: none; }
  button { width: 100%; padding: 6px 10px; border: none; border-radius: 2px; font: inherit; cursor: pointer;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  button:disabled { opacity: .6; cursor: default; }
  .status { margin: 10px 0 0; color: var(--vscode-descriptionForeground); min-height: 1.4em; line-height: 1.4; }
  .links { margin-top: 14px; }
  a { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <section>
    <label for="style">Commit style</label>
    <select id="style" aria-describedby="styleHelp"></select>
    <p class="help" id="styleHelp"></p>
    <p class="note" id="styleNote"></p>
  </section>
  <section>
    <label for="model">Model</label>
    <select id="model" aria-describedby="modelHelp"></select>
    <p class="help" id="modelHelp"></p>
    <p class="note" id="modelNote"></p>
  </section>
  <section>
    <button id="generate">Generate commit message</button>
    <p class="status" id="status" aria-live="polite"></p>
    <p class="links"><a id="openSettings">All settings</a> · <a id="refreshModels">Refresh model list</a></p>
  </section>
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let state = null;

  function option(value, text, selected) {
    const o = document.createElement('option');
    o.value = value; o.textContent = text; o.selected = !!selected;
    return o;
  }

  function render() {
    if (!state) return;
    const styleSel = $('style');
    styleSel.replaceChildren(...state.styles.map(s => option(s.id, s.label, s.id === state.style)));
    const style = state.styles.find(s => s.id === state.style) || state.styles[0];
    $('styleHelp').textContent = style ? style.help : '';
    $('styleNote').textContent = state.styleSource === 'workspace'
      ? 'Set by this workspace\\u2019s settings. Changing it here updates the workspace, not your user settings.'
      : '';

    const modelSel = $('model');
    const defaultText = 'Default' + (state.defaultLabel ? ' (' + state.defaultLabel + ')' : '');
    const children = [option('', defaultText, state.model === '')];
    const main = state.models.filter(m => m.section === 'main');
    const overflow = state.models.filter(m => m.section === 'overflow');
    if (main.length) {
      const g = document.createElement('optgroup'); g.label = 'Models';
      main.forEach(m => g.appendChild(option(m.id, m.label, m.id === state.model)));
      children.push(g);
    }
    if (overflow.length) {
      const g = document.createElement('optgroup'); g.label = 'Older models';
      overflow.forEach(m => g.appendChild(option(m.id, m.label, m.id === state.model)));
      children.push(g);
    }
    if (state.model && !state.models.some(m => m.id === state.model)) {
      children.push(option(state.model, state.model + ' (not in Claude Code\\u2019s list)', true));
    }
    modelSel.replaceChildren(...children);

    const chosen = state.models.find(m => m.id === state.model);
    $('modelHelp').textContent = state.model === ''
      ? 'Uses whatever model Claude Code is set to, so the two always match.' + (state.defaultLabel ? ' Currently ' + state.defaultLabel + '.' : '')
      : (chosen && chosen.description) ? chosen.label + ': ' + chosen.description : (chosen ? chosen.label : state.model);
    $('modelNote').textContent = state.catalogNote
      || (state.catalogSource === 'catalog' ? 'Model list read from Claude Code\\u2019s own picker.' : '');

    $('generate').disabled = !!state.status;
    $('status').textContent = state.status
      || (state.lastRun ? 'Last: ' + state.lastRun.styleLabel + ' \\u00b7 ' + state.lastRun.model + ' \\u00b7 ' + (state.lastRun.durationMs / 1000).toFixed(1) + ' s' : '');
  }

  $('style').addEventListener('change', e => vscode.postMessage({ type: 'setStyle', value: e.target.value }));
  $('model').addEventListener('change', e => vscode.postMessage({ type: 'setModel', value: e.target.value }));
  $('generate').addEventListener('click', () => vscode.postMessage({ type: 'generate' }));
  $('openSettings').addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
  $('refreshModels').addEventListener('click', () => vscode.postMessage({ type: 'refreshModels' }));
  window.addEventListener('message', e => { if (e.data && e.data.type === 'state') { state = e.data; render(); } });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
