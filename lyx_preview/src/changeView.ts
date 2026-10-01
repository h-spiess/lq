export type ChangeViewMode = "original" | "tracked" | "clean";

export function isChangeViewMode(value: unknown): value is ChangeViewMode {
  return value === "original" || value === "tracked" || value === "clean";
}

export function parseChangeViewMessage(message: unknown): ChangeViewMode | undefined {
  if (!message || typeof message !== "object") return undefined;
  const msg = message as { type?: unknown; mode?: unknown };
  return msg.type === "changeView" && isChangeViewMode(msg.mode) ? msg.mode : undefined;
}
