import { describe, expect, it } from "vitest";
import {
  languageServerExecutable,
  languageServerWorkingDirectory
} from "../src/language-server-options";

describe("xaligo language server options", () => {
  it("launches the bundled runtime in LSP mode with its package resources", () => {
    expect(languageServerExecutable(
      {
        source: "bundled",
        binary: "/extension/xaligo",
        packageRoot: "/extension/package",
        identity: {
          version: "0.2.1",
          packageVersion: "0.2.1",
          releaseTag: "v0.2.1",
          prerelease: false
        }
      },
      "/workspace",
      { PATH: "/bin" }
    )).toEqual({
      command: "/extension/xaligo",
      args: ["lsp"],
      options: {
        cwd: "/workspace",
        env: {
          PATH: "/bin",
          XALIGO_LOG_STRUCTURED: "1",
          XALIGO_HOME: "/extension/package"
        }
      }
    });
  });

  it("uses the first workspace folder and supports a process fallback", () => {
    expect(languageServerWorkingDirectory([
      { uri: { fsPath: "/first" } },
      { uri: { fsPath: "/second" } }
    ], "/fallback")).toBe("/first");
    expect(languageServerWorkingDirectory(undefined, "/fallback")).toBe("/fallback");
  });
});
