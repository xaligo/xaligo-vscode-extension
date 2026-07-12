import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface ExtensionManifest {
  activationEvents: string[];
  contributes: {
    commands: Array<{ command: string }>;
    menus: { "webview/title": Array<{ command: string }> };
  };
  dependencies: Record<string, string>;
}

const manifest = JSON.parse(readFileSync(
  new URL("../package.json", import.meta.url),
  "utf8"
)) as ExtensionManifest;

const updateCommands = [
  "xaligo.showUpdates",
  "xaligo.updateRuntime",
  "xaligo.updateExtension"
];

describe("update command manifest", () => {
  it("contributes and activates every update command", () => {
    const contributed = manifest.contributes.commands.map(({ command }) => command);
    for (const command of updateCommands) {
      expect(contributed).toContain(command);
      expect(manifest.activationEvents).toContain(`onCommand:${command}`);
    }
  });

  it("exposes the update menu from a preview and packages safe tar extraction", () => {
    expect(manifest.contributes.menus["webview/title"].map(({ command }) => command)).toContain(
      "xaligo.showUpdates"
    );
    expect(manifest.dependencies.tar).toMatch(/^\^7\./);
  });
});
