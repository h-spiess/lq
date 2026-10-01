import { normalizeFsPath, sameFsPath } from "./fsPath";

/** Panels have separate modes; file-level state survives until the final panel closes. */
export class PreviewPanels<T> {
  private readonly entries = new Map<T, { path: string; order: number; active: boolean }>();
  private clock = 0;

  add(panel: T, path: string): boolean {
    const first = this.forFile(path).length === 0;
    this.entries.set(panel, { path: normalizeFsPath(path), order: ++this.clock, active: false });
    return first;
  }

  activate(panel: T): void {
    for (const entry of this.entries.values()) entry.active = false;
    const entry = this.entries.get(panel);
    if (entry) { entry.active = true; entry.order = ++this.clock; }
  }

  deactivate(panel: T): void {
    const entry = this.entries.get(panel);
    if (entry) entry.active = false;
  }

  active(): T | undefined {
    return [...this.entries].find(([, entry]) => entry.active)?.[0];
  }

  forFile(path: string): T[] {
    return [...this.entries]
      .filter(([, entry]) => sameFsPath(entry.path, path))
      .sort((a, b) => Number(b[1].active) - Number(a[1].active) || b[1].order - a[1].order)
      .map(([panel]) => panel);
  }

  find(path: string): T | undefined { return this.forFile(path)[0]; }

  /** Returns true only when file-level state can now be released. */
  remove(panel: T): boolean {
    const entry = this.entries.get(panel);
    if (!entry) return false;
    this.entries.delete(panel);
    return this.forFile(entry.path).length === 0;
  }
}
