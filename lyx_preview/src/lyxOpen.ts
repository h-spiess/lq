import { accessSync, constants, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32, isAbsolute } from "node:path";
import { spawn } from "node:child_process";

export interface LyxDiscoveryDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  directories?: (path: string) => string[];
  isDirectory?: (path: string) => boolean;
  isExecutable?: (path: string) => boolean;
}

export function isLyxExecutable(path: string, platform = process.platform): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (platform === "win32") return /\.exe$/i.test(path);
    accessSync(path, constants.X_OK);
    return true;
  } catch { return false; }
}

function directories(path: string): string[] {
  try { return readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name); }
  catch { return []; }
}

function isDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function version(name: string): number[] | undefined {
  if (!/^\d+(?:\.\d+)*$/.test(name)) return undefined;
  const parts = name.split(".").map(Number);
  return parts.every((n) => Number.isSafeInteger(n) && n <= 0xffffffff) ? parts : undefined;
}

function newest(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/** Follows schema.rs::get_default_layouts_dir; launching also requires a usable binary. */
export function discoverLyx(deps: LyxDiscoveryDeps = {}): string | undefined {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const list = deps.directories ?? directories;
  const dir = deps.isDirectory ?? isDirectory;
  const executable = deps.isExecutable ?? ((path: string) => isLyxExecutable(path, platform));
  const p = platform === "win32" ? win32 : posix;
  const candidates: { root: string; version: number[] }[] = [];
  const bases = platform === "win32"
    ? [env.PROGRAMFILES, env.LOCALAPPDATA ? p.join(env.LOCALAPPDATA, "Programs") : undefined].filter((base): base is string => Boolean(base))
    : ["/Applications"];
  if (platform === "win32" || platform === "darwin") {
    for (const base of bases) {
      for (const name of list(base)) {
        const match = platform === "win32" ? /^LyX (.+)$/.exec(name) : /^LyX(.+)\.app$/.exec(name);
        const parsed = match && version(match[1]);
        if (parsed) candidates.push({ root: p.join(base, name), version: parsed });
      }
    }
    candidates.sort((a, b) => newest(a.version, b.version));
    const roots = candidates.map((candidate) => candidate.root);
    if (platform === "win32") {
      if (env.LOCALAPPDATA) roots.push(p.join(env.LOCALAPPDATA, "Programs", "LyX 2.5"));
      roots.push("C:\\Program Files\\LyX 2.5");
    } else roots.push("/Applications/LyX.app");
    for (const root of roots) {
      const layouts = platform === "win32" ? p.join(root, "Resources", "layouts") : p.join(root, "Contents", "Resources", "layouts");
      const binary = platform === "win32" ? p.join(root, "bin", "LyX.exe") : p.join(root, "Contents", "MacOS", "lyx");
      if (dir(layouts) && executable(binary)) return binary;
    }
    return undefined;
  }
  for (const prefix of ["/usr", "/usr/local"]) {
    const binary = p.join(prefix, "bin", "lyx");
    if (dir(p.join(prefix, "share", "lyx", "layouts")) && executable(binary)) return binary;
  }
  for (const base of (env.PATH ?? "").split(":")) {
    if (!p.isAbsolute(base)) continue;
    const binary = p.join(base, "lyx");
    if (executable(binary)) return binary;
  }
  return undefined;
}

export function resolveLyxSetting(setting: string, platform = process.platform, home = homedir()): string {
  const raw = setting.trim();
  const p = platform === "win32" ? win32 : posix;
  const path = raw === "~" ? home : /^~[/\\]/.test(raw) ? p.join(home, raw.slice(2)) : raw;
  return platform === "darwin" && /\.app\/?$/i.test(path)
    ? posix.join(path, "Contents", "MacOS", "lyx") : path;
}

export function startLyx(executable: string, file: string, spawnFn: typeof spawn = spawn): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnFn(executable, ["-r", file], { detached: true, windowsHide: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

export interface LyxOpenDocument {
  uri: { scheme: string; fsPath: string };
  isDirty: boolean;
  save(): PromiseLike<boolean>;
}

export interface LyxOpenDeps {
  readSetting(): string;
  pickExecutable(): PromiseLike<string | undefined>;
  rememberExecutable(path: string): PromiseLike<void>;
  discover?: () => string | undefined;
  isExecutable?: (path: string) => boolean;
  resolveSetting?: (setting: string) => string;
  launch?: (executable: string, file: string) => Promise<void>;
}

/** One action at a time, without rendering or starting lq. */
export class LyxOpener {
  private flight: Promise<void> | undefined;
  private cached: string | undefined;
  constructor(private readonly deps: LyxOpenDeps) {}

  invalidate(): void { this.cached = undefined; }

  open(document: LyxOpenDocument, supportedHost = true): Promise<void> {
    if (this.flight) return this.flight;
    const flight = this.perform(document, supportedHost);
    this.flight = flight;
    void flight.finally(() => { if (this.flight === flight) this.flight = undefined; }).catch(() => {});
    return flight;
  }

  private async perform(document: LyxOpenDocument, supportedHost: boolean): Promise<void> {
    if (!supportedHost) throw new Error("Open in LyX requires desktop VS Code with a local document. Open a local copy to use this action.");
    if (document.uri.scheme !== "file" || !/\.lyx$/i.test(document.uri.fsPath) || !isAbsolute(document.uri.fsPath)) {
      throw new Error("Save this document as a local .lyx file before opening it in LyX.");
    }
    const valid = this.deps.isExecutable ?? isLyxExecutable;
    const resolve = this.deps.resolveSetting ?? resolveLyxSetting;
    const setting = this.deps.readSetting().trim();
    let binary: string | undefined;
    if (setting) {
      binary = resolve(setting);
      if (!isAbsolute(binary) || !valid(binary)) throw new Error(`Could not use LyX at '${binary}'. Set lyx-preview.lyxPath to the LyX executable, or clear it to search automatically.`);
    } else {
      if (this.cached && !valid(this.cached)) this.cached = undefined;
      binary = this.cached ?? (this.deps.discover ?? discoverLyx)();
      if (binary && (!isAbsolute(binary) || !valid(binary))) binary = undefined;
      this.cached = binary;
      if (!binary) {
        const selected = await this.deps.pickExecutable();
        if (!selected) return;
        binary = resolve(selected);
        if (!isAbsolute(binary) || !valid(binary)) throw new Error("The selected file is not a usable LyX executable. Select LyX.exe on Windows, LyX.app on macOS, or the lyx executable on Linux.");
        await this.deps.rememberExecutable(selected);
      }
    }
    if (document.isDirty && !await document.save()) return;
    try { await (this.deps.launch ?? startLyx)(binary, document.uri.fsPath); }
    catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not start LyX at '${binary}'. Check lyx-preview.lyxPath. ${detail}`, { cause: error });
    }
  }
}
