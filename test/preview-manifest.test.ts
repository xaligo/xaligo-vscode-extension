import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface ExtensionManifest {
  contributes: {
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
});
