import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  runExtensionUpdate,
  type ExtensionUpdateWorkflowHost
} from "../src/extension-update-workflow";

function host(overrides: Partial<ExtensionUpdateWorkflowHost> = {}): ExtensionUpdateWorkflowHost {
  return {
    extensionId: "xaligo.xaligo-vscode-extension",
    production: true,
    getCommands: vi.fn(async () => ["workbench.extensions.installExtension"]),
    installExtension: vi.fn(async () => undefined),
    searchExtension: vi.fn(async () => undefined),
    reloadWindow: vi.fn(async () => undefined),
    information: vi.fn(async () => undefined),
    warning: vi.fn(async () => undefined),
    error: vi.fn(async () => undefined),
    ...overrides
  };
}

describe("extension update workflow", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("installs only the current extension ID in production", async () => {
    const updateHost = host();
    await runExtensionUpdate(updateHost);
    expect(updateHost.installExtension).toHaveBeenCalledWith("xaligo.xaligo-vscode-extension");
    expect(updateHost.searchExtension).not.toHaveBeenCalled();
    expect(updateHost.reloadWindow).not.toHaveBeenCalled();
  });

  it("reloads only after the user explicitly chooses it", async () => {
    const updateHost = host({ information: vi.fn(async () => "Reload Window") });
    await runExtensionUpdate(updateHost);
    expect(updateHost.reloadWindow).toHaveBeenCalledOnce();
  });

  it("opens extension details instead of installing in development", async () => {
    const updateHost = host({ production: false });
    await runExtensionUpdate(updateHost);
    expect(updateHost.installExtension).not.toHaveBeenCalled();
    expect(updateHost.searchExtension).toHaveBeenCalledWith(updateHost.extensionId);
  });

  it("falls back to extension details when the install command is unavailable", async () => {
    const updateHost = host({ getCommands: vi.fn(async () => []) });
    await runExtensionUpdate(updateHost);
    expect(updateHost.warning).toHaveBeenCalledOnce();
    expect(updateHost.installExtension).not.toHaveBeenCalled();
    expect(updateHost.searchExtension).toHaveBeenCalledOnce();
  });

  it("reports install and search failures without retrying installation", async () => {
    const updateHost = host({
      installExtension: vi.fn(async () => { throw new Error("install failed"); }),
      searchExtension: vi.fn(async () => { throw new Error("search failed"); })
    });
    await runExtensionUpdate(updateHost);
    expect(updateHost.installExtension).toHaveBeenCalledOnce();
    expect(updateHost.searchExtension).toHaveBeenCalledOnce();
    expect(updateHost.error).toHaveBeenCalledTimes(2);
  });
});
