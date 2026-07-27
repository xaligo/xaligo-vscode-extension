import type { XaligoRuntimeSelection } from "./runtime-resolver";

export function runtimeEnvironment(
  runtime: XaligoRuntimeSelection,
  environment: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    ...environment,
    XALIGO_LOG_STRUCTURED: "1"
  };
  if (runtime.source !== "custom") {
    result.XALIGO_HOME = runtime.packageRoot;
  }
  return result;
}
