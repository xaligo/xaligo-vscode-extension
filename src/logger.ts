import * as vscode from "vscode";

let channel: vscode.LogOutputChannel | undefined;

/**
 * Creates the extension's shared log output channel. Call once from
 * `activate()` and add the result to `context.subscriptions`.
 *
 * The channel is a VS Code `LogOutputChannel`, so its verbosity is controlled
 * by the standard "Developer: Set Log Level..." command (scoped to the
 * "xaligo" extension) instead of a custom setting.
 */
export function createXaligoLogger(): vscode.LogOutputChannel {
  channel = vscode.window.createOutputChannel("xaligo", { log: true });
  return channel;
}

/**
 * Returns the shared log channel created by `createXaligoLogger`. Falls back
 * to a no-op logger when called before activation (for example from a unit
 * test that constructs a class directly without running `activate()`).
 */
export function xaligoLogger(): vscode.LogOutputChannel {
  return channel ?? noopLogger;
}

const noopLogger: vscode.LogOutputChannel = {
  name: "xaligo",
  logLevel: 0,
  onDidChangeLogLevel: () => ({ dispose: () => undefined }),
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  append: () => undefined,
  appendLine: () => undefined,
  replace: () => undefined,
  clear: () => undefined,
  show: () => undefined,
  hide: () => undefined,
  dispose: () => undefined
} as unknown as vscode.LogOutputChannel;
