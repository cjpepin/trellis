import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);

export const scriptsDir = path.resolve(currentDir, "..");
export const repoRootDir = path.resolve(scriptsDir, "..");

export function fromRepoRoot(...segments) {
  return path.join(repoRootDir, ...segments);
}
