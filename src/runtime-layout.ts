import { promises as fs } from "node:fs";
import path from "node:path";

export const requiredRuntimeRelativeFiles = [
  "package.json",
  "VERSION",
  path.join("etc", "resources", "aws", "app.yaml"),
  path.join("etc", "resources", "aws", "service-catalog.csv"),
  path.join("etc", "resources", "aws", "service-index.csv"),
  path.join(
    "etc",
    "resources",
    "aws",
    "svg",
    "Architecture-Group-Icons",
    "AWS-Account_32.svg"
  ),
  path.join("etc", "resources", "aws", "svg", "Tabler-Icons", "LICENSE")
] as const;

export async function missingRuntimeFiles(packageRoot: string): Promise<string[]> {
  const checks = await Promise.all(requiredRuntimeRelativeFiles.map(async (relativePath) => {
    try {
      const info = await fs.stat(path.join(packageRoot, relativePath));
      return info.isFile() && info.size > 0 ? undefined : relativePath;
    } catch {
      return relativePath;
    }
  }));
  return checks.filter((relativePath): relativePath is string => relativePath !== undefined);
}

export async function hasCompleteRuntimeLayout(packageRoot: string): Promise<boolean> {
  return (await missingRuntimeFiles(packageRoot)).length === 0;
}
