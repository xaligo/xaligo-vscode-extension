import { runtimeEnvironment } from "./runtime-environment";
import type { XaligoRuntimeSelection } from "./runtime-resolver";

export interface LanguageServerWorkspaceFolder {
  uri: {
    fsPath: string;
  };
}

export interface XaligoLanguageServerExecutable {
  command: string;
  args: string[];
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
  };
}

export function languageServerWorkingDirectory(
  workspaceFolders: readonly LanguageServerWorkspaceFolder[] | undefined,
  fallback = process.cwd()
): string {
  return workspaceFolders?.[0]?.uri.fsPath || fallback;
}

export function languageServerExecutable(
  runtime: XaligoRuntimeSelection,
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env
): XaligoLanguageServerExecutable {
  return {
    command: runtime.binary,
    args: ["lsp"],
    options: {
      cwd,
      env: runtimeEnvironment(runtime, environment)
    }
  };
}
