import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, it } from "node:test";
import type * as vscode from "vscode";
import type { LiveRender } from "./previewSession";
import { LyxOpener, type LyxOpenDeps } from "./lyxOpen";
import * as liveSelection from "./liveSelection";
import { getCachedOutline } from "./outlineProvider";
import { normalizeFsPath } from "./fsPath";

// Exercise the real activation/provider/command code, with only host and process I/O replaced.
function event() {
  const listeners = new Set<(value: any) => void>();
  return {
    listen(callback: (value: any) => void, _this?: unknown, disposables?: any[]) {
      listeners.add(callback);
      const disposable = { dispose: () => { listeners.delete(callback); } };
      disposables?.push(disposable);
      return disposable;
    },
    fire(value: any) { for (const callback of [...listeners]) callback(value); },
  };
}

class Uri {
  constructor(public scheme: string, public fsPath: string) {}
  static file(path: string) { return new Uri("file", path); }
  toString() { return `${this.scheme}://${this.fsPath}`; }
}
class TextInput { constructor(public uri: Uri) {} }
class CustomInput { constructor(public uri: Uri, public viewType: string) {} }
const A = join(tmpdir(), "lq-host-a.lyx"), B = join(tmpdir(), "lq-host-b.lyx");
const commands = new Map<string, (...args: any[]) => any>();
const executed: any[][] = [], opened: string[] = [], rendered: string[] = [], launched: string[] = [], persisted: string[] = [], errors: string[] = [];
const savedEvent = event(), changedEvent = event(), configEvent = event(), editorEvent = event();
const docs: any[] = [], panels: any[] = [];
let provider: vscode.CustomTextEditorProvider;
let providerOptions: any;
let pending: ((file: string) => Promise<LiveRender>) | undefined;
const context = { subscriptions: [] as any[] };
const windowHost: any = {
  activeTextEditor: undefined,
  tabGroups: { activeTabGroup: { activeTab: undefined } },
  registerCustomEditorProvider(_view: string, p: vscode.CustomTextEditorProvider, options: any) {
    provider = p; providerOptions = options; return { dispose() {} };
  },
  createTreeView: () => ({ dispose() {} }),
  createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
  showWarningMessage: async (s: string) => { errors.push(s); },
  showErrorMessage: async (s: string) => { errors.push(s); },
  showOpenDialog: async () => undefined,
  showQuickPick: async () => undefined,
  onDidChangeActiveTextEditor: editorEvent.listen,
};
const env = { uiKind: 1, remoteName: undefined as string | undefined };
const fakeVscode = {
  Uri, TabInputText: TextInput, TabInputCustom: CustomInput,
  ViewColumn: { Active: -1 }, UIKind: { Desktop: 1 }, ConfigurationTarget: { Global: 1 }, StatusBarAlignment: { Right: 2 },
  RelativePattern: class { constructor(_base: any, _pattern: any) {} },
  window: windowHost, env,
  commands: {
    registerCommand(name: string, callback: (...args: any[]) => any) { commands.set(name, callback); return { dispose() {} }; },
    executeCommand: async (...args: any[]) => { executed.push(args); },
  },
  workspace: {
    textDocuments: docs, workspaceFolders: [],
    getConfiguration: () => ({ get: () => undefined, update: async () => {} }),
    openTextDocument: async (uri: Uri) => { opened.push(uri.fsPath); return docs.find((d) => d.uri.fsPath === uri.fsPath); },
    onDidSaveTextDocument: savedEvent.listen, onDidChangeTextDocument: changedEvent.listen, onDidChangeConfiguration: configEvent.listen,
    createFileSystemWatcher: () => ({ onDidChange: event().listen, onDidCreate: event().listen, onDidDelete: event().listen, dispose() {} }),
  },
};

function render(file: string): LiveRender {
  return {
    contract: "lyx-preview/live-1", projection: "live", html: '<article class="lyx-live">Hello</article>',
    source: { path: file, hashAlgorithm: "sha256", hashInput: "raw-file-bytes", diskHash: "a".repeat(64), lineEnding: "lf", lineCount: 2, fresh: true },
    capabilities: { review: false, mapping: true, outline: true, editing: false, sourceReveal: false },
    outline: [], changes: [], tokens: [], diagnostics: [], navigate: { figures: [], tables: [], equations: [], labels: [], listings: [], algorithms: [] },
  };
}

const Module = require("node:module") as { _load(request: string, parent: any, isMain: boolean): any };
const originalLoad = Module._load;
let extension: typeof import("./extension");
try {
  Module._load = (request, parent, isMain) => {
    if (request === "vscode") return fakeVscode;
    if (request === "./outlineTree") return { LyxOutlineTreeProvider: class { refresh() {} clear() {} } };
    if (request === "./lqClient") return { ensureCompanionLq: async () => {}, discoverLqBinary: () => "fake-lq" };
    if (request === "./lqRunner") return { runLivePreview: async (_exe: string, file: string) => { rendered.push(file); return pending ? pending(file) : render(file); } };
    if (request === "./liveSelection") return { ...liveSelection, LiveSelectionPersister: class { persist(_record: unknown, file: string) { persisted.push(file); } } };
    if (request === "./lyxOpen") return { LyxOpener: class extends LyxOpener {
      constructor(deps: LyxOpenDeps) { super({ ...deps, discover: () => join(tmpdir(), "LyX.exe"), isExecutable: () => true, launch: async (_exe, file) => { launched.push(file); } }); }
    } };
    return originalLoad(request, parent, isMain);
  };
  extension = require("./extension");
} finally { Module._load = originalLoad; }
extension.activate(context as vscode.ExtensionContext);

function document(file: string, dirty = false) {
  const doc = { uri: Uri.file(file), fileName: file, isDirty: dirty, getText: () => "Hello", save: async () => { doc.isDirty = false; savedEvent.fire(doc); return true; } };
  docs.push(doc);
  return doc;
}

function panel(active = false) {
  const disposed = event(), state = event(), message = event();
  const p: any = {
    active, title: "", onDidDispose: disposed.listen, onDidChangeViewState: state.listen,
    dispose() { disposed.fire(undefined); },
    activate() {
      for (const other of panels) { if (other.active) { other.active = false; other.state.fire({ webviewPanel: other }); } }
      p.active = true; state.fire({ webviewPanel: p });
    }, state, message,
    webview: { options: undefined, html: "", cspSource: "vscode-webview:", onDidReceiveMessage: message.listen, messages: [] as any[],
      postMessage: async (msg: any) => { p.webview.messages.push(msg); return true; }, asWebviewUri: (uri: Uri) => uri,
    },
  };
  panels.push(p);
  return p;
}
const token = { isCancellationRequested: false, onCancellationRequested: event().listen };
async function resolve(doc: any, p: any, canceled = false) {
  await provider.resolveCustomTextEditor(doc, p, { ...token, isCancellationRequested: canceled } as vscode.CancellationToken);
  await new Promise<void>((done) => setImmediate(done));
}

afterEach(() => {
  for (const p of panels) p.dispose();
  panels.length = 0; docs.length = 0;
  for (const calls of [executed, opened, rendered, launched, persisted, errors]) calls.length = 0;
  pending = undefined; env.remoteName = undefined; env.uiKind = 1;
  windowHost.tabGroups.activeTabGroup.activeTab = undefined; windowHost.activeTextEditor = undefined;
  configEvent.fire({ affectsConfiguration: () => true });
});

describe("native Preview provider and commands", () => {
  it("uses the supplied panel/document and preserves an initial dirty banner", async () => {
    const doc = document(A, true), p = panel(true);
    await resolve(doc, p);
    assert.equal(providerOptions.webviewOptions.retainContextWhenHidden, true);
    assert.equal(providerOptions.webviewOptions.enableFindWidget, true);
    assert.equal(p.webview.options.enableScripts, true);
    assert.ok(p.webview.options.localResourceRoots.some((uri: Uri) => uri.fsPath === tmpdir()));
    assert.match(p.webview.html, /Unsaved edits/);
    assert.deepEqual(rendered, [normalizeFsPath(A)]);
  });

  it("does not initialize a canceled editor", async () => {
    const p = panel();
    await resolve(document(A), p, true);
    assert.equal(p.webview.html, "");
    assert.deepEqual(rendered, []);
  });

  it("keeps split modes independent, refreshes both on save, and retains the surviving panel/cache", async () => {
    const doc = document(A), first = panel(true), second = panel();
    await resolve(doc, first); await resolve(doc, second);
    first.message.fire({ type: "changeView", mode: "original" });
    second.message.fire({ type: "changeView", mode: "clean" });
    assert.match(first.webview.html, /body data-mode="original"/);
    assert.match(second.webview.html, /body data-mode="clean"/);
    const before = rendered.length;
    second.message.fire({ type: "changeView", mode: "bad" });
    assert.equal(rendered.length, before);
    savedEvent.fire(doc);
    await new Promise<void>((done) => setImmediate(done));
    assert.equal(rendered.length, before + 2);
    assert.match(first.webview.html, /body data-mode="original"/);
    assert.match(second.webview.html, /body data-mode="clean"/);
    assert.ok(getCachedOutline(A));
    persisted.length = 0;
    first.dispose();
    assert.ok(getCachedOutline(A));
    assert.deepEqual(persisted, []);
    second.message.fire({ type: "ready" });
    second.message.fire({ type: "changeView", mode: "tracked" });
    assert.deepEqual(second.webview.messages.at(-1), { type: "setMode", mode: "tracked" });
    second.dispose();
    assert.equal(getCachedOutline(A), undefined);
  });

  it("preserves a mode selected during rendering and ignores a disposed render", async () => {
    let finish!: (value: LiveRender) => void;
    pending = () => new Promise<LiveRender>((done) => { finish = done; });
    const p = panel(true);
    await resolve(document(A), p);
    p.message.fire({ type: "changeView", mode: "clean" });
    finish(render(A));
    await new Promise<void>((done) => setImmediate(done));
    assert.match(p.webview.html, /body data-mode="clean"/);
    const canceled = panel();
    await resolve(document(B), canceled);
    canceled.dispose();
    const before = canceled.webview.html;
    finish(render(B));
    await new Promise<void>((done) => setImmediate(done));
    assert.equal(canceled.webview.html, before);
    assert.equal(getCachedOutline(B), undefined);
  });

  it("opens Preview through the registered editor instead of a standalone panel", async () => {
    const doc = document(A);
    windowHost.tabGroups.activeTabGroup.activeTab = { input: new TextInput(doc.uri) };
    await commands.get("lyx-preview.open")!();
    assert.deepEqual(executed, [["vscode.openWith", doc.uri, "lyxPreview.live", { viewColumn: -1 }]]);
  });

  it("opens the invoking Preview B rather than the raw editor A, and honors an explicit toolbar URI", async () => {
    const raw = document(A, true), preview = document(B, true), p = panel(true);
    await resolve(preview, p);
    windowHost.activeTextEditor = { document: raw };
    windowHost.tabGroups.activeTabGroup.activeTab = { input: new CustomInput(preview.uri, "lyxPreview.live") };
    await commands.get("lyx-preview.openInLyx")!();
    assert.deepEqual(opened, [B]); assert.deepEqual(launched, [B]);
    assert.equal(raw.isDirty, true); assert.equal(preview.isDirty, false);
    await commands.get("lyx-preview.openInLyx")!(raw.uri);
    assert.deepEqual(launched, [B, A]);
  });

  it("rejects remote/virtual targets without loading a document or launching", async () => {
    const doc = document(A);
    env.remoteName = "ssh-remote";
    await commands.get("lyx-preview.openInLyx")!(doc.uri);
    assert.deepEqual(opened, []); assert.deepEqual(launched, []);
    assert.match(errors[0], /local/);
    env.remoteName = undefined;
    await commands.get("lyx-preview.openInLyx")!(new Uri("untitled", A));
    assert.deepEqual(opened, []);
  });
});
