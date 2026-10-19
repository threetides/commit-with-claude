import * as fs from "node:fs";
import * as vscode from "vscode";
import { catalogDir, readCatalog, type CatalogInfo } from "./catalog";
import type { Logger } from "./log";

/** Caches the model catalog and refreshes when Claude Code rewrites it. */
export class CatalogService implements vscode.Disposable {
  private info: CatalogInfo;
  private watcher?: fs.FSWatcher;
  private timer?: NodeJS.Timeout;
  private readonly emitter = new vscode.EventEmitter<CatalogInfo>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly log: Logger) {
    this.info = readCatalog();
    this.log.info(`Model catalog: ${this.info.source}, ${this.info.models.length} models${this.info.currentModelLabel ? `, Claude Code default is ${this.info.currentModelLabel}` : ""}`);
    try {
      this.watcher = fs.watch(catalogDir(), () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.refresh(), 500);
      });
    } catch {
      /* directory missing; fallback list is in use */
    }
  }

  get(): CatalogInfo {
    return this.info;
  }

  refresh(): CatalogInfo {
    this.info = readCatalog();
    this.log.debug(`Model catalog refreshed: ${this.info.models.length} models`);
    this.emitter.fire(this.info);
    return this.info;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.watcher?.close();
    this.emitter.dispose();
  }
}
