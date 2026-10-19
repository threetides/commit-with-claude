import * as vscode from "vscode";

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}

export class Logger implements vscode.Disposable {
  private readonly channel = vscode.window.createOutputChannel("Commit with Claude");
  debugEnabled = false;

  info(msg: string): void {
    this.channel.appendLine(`[${ts()}] ${msg}`);
  }
  debug(msg: string): void {
    if (this.debugEnabled) this.channel.appendLine(`[${ts()}] [debug] ${msg}`);
  }
  error(msg: string): void {
    this.channel.appendLine(`[${ts()}] ERROR ${msg}`);
  }
  show(): void {
    this.channel.show(true);
  }
  dispose(): void {
    this.channel.dispose();
  }
}
