import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { describe, it } from "node:test";
import { discoverLyx, isLyxExecutable, LyxOpener, resolveLyxSetting, startLyx, type LyxOpenDeps } from "./lyxOpen";

const DOC = join(tmpdir(), "a space 文档.lyx");
const BIN = join(tmpdir(), "LyX.exe");

describe("LyX discovery", () => {
  it("uses numeric versions, stable base order, and skips incomplete Windows installs", () => {
    const lists: Record<string, string[]> = {
      "C:\\PF": ["LyX 2.9", "LyX 2.10", "LyX 3.0", "LyX beta", "other"],
      "C:\\Local\\Programs": ["LyX 2.10"],
    };
    const usable = new Set(["C:\\PF\\LyX 2.9\\bin\\LyX.exe", "C:\\PF\\LyX 2.10\\bin\\LyX.exe", "C:\\Local\\Programs\\LyX 2.10\\bin\\LyX.exe"]);
    const deps = { platform: "win32" as const, env: { PROGRAMFILES: "C:\\PF", LOCALAPPDATA: "C:\\Local" }, directories: (p: string) => lists[p] ?? [], isDirectory: () => true, isExecutable: (p: string) => usable.has(p) };
    assert.equal(discoverLyx(deps), "C:\\PF\\LyX 2.10\\bin\\LyX.exe");
    usable.delete("C:\\PF\\LyX 2.10\\bin\\LyX.exe");
    assert.equal(discoverLyx(deps), "C:\\Local\\Programs\\LyX 2.10\\bin\\LyX.exe");
    assert.equal(discoverLyx({ ...deps, isDirectory: () => false }), undefined);
  });

  it("uses Windows fallback locations without scanning the current directory", () => {
    const visited: string[] = [];
    const deps = { platform: "win32" as const, env: {}, directories: (p: string) => { visited.push(p); return []; }, isDirectory: () => true, isExecutable: (p: string) => p === "C:\\Program Files\\LyX 2.5\\bin\\LyX.exe" };
    assert.equal(discoverLyx(deps), "C:\\Program Files\\LyX 2.5\\bin\\LyX.exe");
    assert.deepEqual(visited, []);
  });

  it("handles versioned and unversioned macOS bundles", () => {
    const deps = { platform: "darwin" as const, env: {}, directories: () => ["LyX2.9.app", "LyX2.10.app", "LyX.app", "LyXbroken.app"], isDirectory: () => true, isExecutable: () => true };
    assert.equal(discoverLyx(deps), "/Applications/LyX2.10.app/Contents/MacOS/lyx");
    assert.equal(discoverLyx({ ...deps, directories: () => [] }), "/Applications/LyX.app/Contents/MacOS/lyx");
    assert.equal(resolveLyxSetting("~/LyX.app", "darwin", "/users/me"), "/users/me/LyX.app/Contents/MacOS/lyx");
  });

  it("uses Linux prefixes then absolute PATH entries", () => {
    const usable = new Set(["/usr/local/bin/lyx", "/opt/bin/lyx"]);
    const deps = { platform: "linux" as const, env: { PATH: ":relative:/opt/bin" }, isDirectory: () => true, isExecutable: (p: string) => usable.has(p) };
    assert.equal(discoverLyx(deps), "/usr/local/bin/lyx");
    assert.equal(discoverLyx({ ...deps, isDirectory: () => false }), "/opt/bin/lyx");
    assert.equal(discoverLyx({ ...deps, env: { PATH: "" }, isDirectory: () => false }), undefined);
  });

  it("validates files and executable permissions without launching them", () => {
    const folder = mkdtempSync(join(tmpdir(), "lyx-open-"));
    try {
      const exe = join(folder, "LyX.exe");
      writeFileSync(exe, "fixture");
      assert.equal(isLyxExecutable(exe, "win32"), true);
      assert.equal(isLyxExecutable(folder, "win32"), false);
      assert.equal(isLyxExecutable(join(folder, "missing.exe"), "win32"), false);
      if (process.platform !== "win32") {
        chmodSync(exe, 0o600);
        assert.equal(isLyxExecutable(exe, "linux"), false);
        chmodSync(exe, 0o700);
        assert.equal(isLyxExecutable(exe, "linux"), true);
      }
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
});

function setup(overrides: Partial<LyxOpenDeps> = {}) {
  const calls: string[] = [];
  const deps: LyxOpenDeps = {
    readSetting: () => "", discover: () => { calls.push("discover"); return BIN; },
    isExecutable: () => true, resolveSetting: (s) => s,
    pickExecutable: async () => { calls.push("pick"); return undefined; },
    rememberExecutable: async (p) => { calls.push(`remember:${p}`); },
    launch: async (exe, file) => { calls.push(`launch:${exe}:${file}`); },
    ...overrides,
  };
  const doc = { uri: { scheme: "file", fsPath: DOC }, isDirty: true, save: async () => { calls.push("save"); return true; } };
  return { opener: new LyxOpener(deps), doc, calls };
}

describe("Open in LyX action", () => {
  it("discovers, saves only the requested document, then launches without a picker", async () => {
    const { opener, doc, calls } = setup();
    await opener.open(doc);
    assert.deepEqual(calls, ["discover", "save", `launch:${BIN}:${DOC}`]);
  });

  it("prefers an explicit override and reports invalid overrides", async () => {
    const manual = join(tmpdir(), "Manual.exe");
    const { opener, doc, calls } = setup({ readSetting: () => manual });
    await opener.open(doc);
    assert.deepEqual(calls, ["save", `launch:${manual}:${DOC}`]);
    const invalid = setup({ readSetting: () => manual, isExecutable: () => false });
    await assert.rejects(invalid.opener.open(invalid.doc), /lyx-preview.lyxPath/);
    assert.deepEqual(invalid.calls, []);
  });

  it("uses and remembers the manual fallback, or stops on picker cancellation", async () => {
    const picked = join(tmpdir(), "Picked.exe");
    const yes = setup({ discover: () => undefined, pickExecutable: async () => picked });
    await yes.opener.open(yes.doc);
    assert.deepEqual(yes.calls, [`remember:${picked}`, "save", `launch:${picked}:${DOC}`]);
    const no = setup({ discover: () => undefined });
    await no.opener.open(no.doc);
    assert.deepEqual(no.calls, ["pick"]);
  });

  it("does not launch on canceled or failed saves and releases the flight", async () => {
    const { opener, doc, calls } = setup();
    doc.save = async () => false;
    await opener.open(doc);
    assert.deepEqual(calls, ["discover"]);
    doc.save = async () => { throw new Error("save failed"); };
    await assert.rejects(opener.open(doc), /save failed/);
    doc.isDirty = false;
    await opener.open(doc);
    assert.equal(calls.at(-1), `launch:${BIN}:${DOC}`);
  });

  it("revalidates automatic results and invalidates the session cache", async () => {
    let valid = true;
    const { opener, doc, calls } = setup({ isExecutable: () => valid });
    doc.isDirty = false;
    await opener.open(doc);
    await opener.open(doc);
    assert.equal(calls.filter((c) => c === "discover").length, 1);
    opener.invalidate();
    await opener.open(doc);
    assert.equal(calls.filter((c) => c === "discover").length, 2);
    valid = false;
    await opener.open(doc);
    assert.equal(calls.at(-1), "pick");
    assert.equal(calls.filter((c) => c === "discover").length, 3);
  });

  it("shares repeated clicks until the current action finishes", async () => {
    let finish!: () => void;
    const { opener, doc, calls } = setup({ launch: () => new Promise<void>((resolve) => { finish = resolve; }) });
    doc.isDirty = false;
    const one = opener.open(doc), two = opener.open(doc);
    assert.equal(one, two);
    assert.deepEqual(calls, ["discover"]);
    finish();
    await one;
  });

  it("rejects unsupported hosts, virtual/untitled documents and non-lyx files", async () => {
    for (const scheme of ["untitled", "vscode-remote", "git"]) {
      const { opener, doc, calls } = setup();
      doc.uri.scheme = scheme;
      await assert.rejects(opener.open(doc), /local .lyx/);
      assert.deepEqual(calls, []);
    }
    const unsupported = setup();
    await assert.rejects(unsupported.opener.open(unsupported.doc, false), /desktop VS Code/);
    const other = setup();
    other.doc.uri.fsPath = join(tmpdir(), "a.txt");
    await assert.rejects(other.opener.open(other.doc), /local .lyx/);
  });

  it("reports process-start errors with the executable and setting", async () => {
    const { opener, doc } = setup({ launch: async () => { throw new Error("ENOENT"); } });
    await assert.rejects(opener.open(doc), /Could not start LyX.*lyx-preview.lyxPath.*ENOENT/);
  });
});

describe("LyX process launch", () => {
  it("uses separate arguments, hidden window, no shell, and resolves on spawn", async () => {
    const child = Object.assign(new EventEmitter(), { unref: () => { unrefed = true; } });
    let unrefed = false;
    const fake = ((exe: string, args: string[], options: object) => {
      assert.equal(exe, BIN);
      assert.deepEqual(args, ["-r", DOC]);
      assert.deepEqual(options, { detached: true, windowsHide: true, stdio: "ignore" });
      queueMicrotask(() => child.emit("spawn"));
      return child as unknown as ChildProcess;
    }) as typeof spawn;
    await startLyx(BIN, DOC, fake);
    assert.equal(unrefed, true);
  });

  it("rejects a spawn error without waiting for process exit", async () => {
    const fake = (() => {
      const child = Object.assign(new EventEmitter(), { unref: () => {} });
      queueMicrotask(() => child.emit("error", new Error("start error")));
      return child as unknown as ChildProcess;
    }) as typeof spawn;
    await assert.rejects(startLyx(BIN, DOC, fake), /start error/);
  });
});
