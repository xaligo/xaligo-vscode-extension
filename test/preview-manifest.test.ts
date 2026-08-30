import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface ExtensionManifest {
  version: string;
  engines: {
    vscode: string;
  };
  dependencies: Record<string, string>;
  contributes: {
    configurationDefaults: Record<string, unknown>;
    commands: Array<{
      command: string;
      icon?: string | { light: string; dark: string };
    }>;
    menus: {
      "editor/title": Array<{
        command: string;
        when?: string;
      }>;
    };
    configuration: {
      properties: Record<string, {
        type: string;
        default: unknown;
        minimum?: number;
        maximum?: number;
      }>;
    };
  };
}

const manifest = JSON.parse(await readFile(
  new URL("../package.json", import.meta.url),
  "utf8"
)) as ExtensionManifest;

describe("preview editor title action", () => {
  it("uses the xaligo icon", () => {
    const command = manifest.contributes.commands.find(
      (candidate) => candidate.command === "xaligo.openPreview"
    );
    expect(command?.icon).toEqual({
      light: "./assets/xaligo-file-icon.svg",
      dark: "./assets/xaligo-file-icon.svg"
    });
  });

  it("is visible for xaligo and Markdown files", () => {
    const menu = manifest.contributes.menus["editor/title"].find(
      (candidate) => candidate.command === "xaligo.openPreview"
    );
    expect(menu?.when).toBe(
      "resourceLangId == xal || resourceExtname == .md || resourceExtname == .markdown"
    );
  });

  it("shows LSP suggestions while editing xaligo documents", () => {
    expect(manifest.contributes.configurationDefaults["[xal]"]).toEqual({
      "editor.quickSuggestions": {
        other: "on",
        comments: "off",
        strings: "on"
      },
      "editor.suggestOnTriggerCharacters": true,
      "editor.wordBasedSuggestions": "off"
    });
  });

  it("targets stable xaligo 0.2.3 without exposing terminal-backed actions", () => {
    const commandIDs = manifest.contributes.commands.map(({ command }) => command);
    expect(manifest.version).toBe("0.0.22");
    expect(manifest.engines.vscode).toBe("^1.91.0");
    expect(manifest.dependencies["@xaligo/xaligo"]).toBe("0.2.3");
    expect(manifest.dependencies["vscode-languageclient"]).toBe("^10.1.1");
    expect(commandIDs).not.toEqual(expect.arrayContaining([
      "xaligo.renderTerminal",
      "xaligo.runCliCommand"
    ]));
    expect(manifest.contributes.commands).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ icon: "$(terminal)" })
    ]));
    expect(manifest.contributes.configuration.properties).not.toHaveProperty("xaligo.servePort");
    expect(commandIDs).not.toEqual(expect.arrayContaining([
      "xaligo.exportExcalidraw",
      "xaligo.exportPdf",
      "xaligo.exportExcel",
      "xaligo.exportXyflow",
      "xaligo.exportIsoflow"
    ]));
  });
});
