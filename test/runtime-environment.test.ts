import { describe, expect, it } from "vitest";
import { runtimeEnvironment } from "../src/runtime-environment";

describe("runtime process environment", () => {
  it("does not pair a custom executable with bundled resources", () => {
    expect(runtimeEnvironment(
      { source: "custom", binary: "C:\\tools\\xaligo.exe" },
      { PATH: "test", XALIGO_HOME: "caller-owned" }
    )).toEqual({
      PATH: "test",
      XALIGO_HOME: "caller-owned",
      XALIGO_LOG_STRUCTURED: "1"
    });
  });

  it("sets XALIGO_HOME for a packaged runtime", () => {
    const environment = runtimeEnvironment({
      source: "bundled",
      binary: "/extension/xaligo",
      packageRoot: "/extension/package",
      identity: {
        version: "0.1.25",
        packageVersion: "0.1.25",
        releaseTag: "v0.1.25"
      }
    }, {});
    expect(environment).toEqual({
      XALIGO_HOME: "/extension/package",
      XALIGO_LOG_STRUCTURED: "1"
    });
  });
});
