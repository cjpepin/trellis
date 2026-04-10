import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fromRepoRoot } from "./lib/repo-paths.mjs";

const nodeTestsDir = fromRepoRoot("tests", "node");

function listNodeTestFiles(rootPath) {
  const testFiles = [];
  const pendingPaths = [rootPath];

  while (pendingPaths.length > 0) {
    const currentPath = pendingPaths.pop();

    if (!currentPath || !fs.existsSync(currentPath)) {
      continue;
    }

    const stats = fs.statSync(currentPath);

    if (stats.isFile()) {
      if (currentPath.endsWith(".test.cjs")) {
        testFiles.push(currentPath);
      }
      continue;
    }

    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      pendingPaths.push(path.join(currentPath, entry.name));
    }
  }

  return testFiles.sort((left, right) => left.localeCompare(right));
}

const requestedPaths = process.argv
  .slice(2)
  .map((targetPath) =>
    path.isAbsolute(targetPath) ? targetPath : fromRepoRoot(targetPath)
  );

const testFiles =
  requestedPaths.length > 0
    ? requestedPaths.flatMap((targetPath) => listNodeTestFiles(path.resolve(targetPath)))
    : listNodeTestFiles(nodeTestsDir);

if (testFiles.length === 0) {
  const searchTarget =
    requestedPaths.length > 0
      ? requestedPaths.map((targetPath) => path.relative(fromRepoRoot(), targetPath)).join(", ")
      : path.relative(fromRepoRoot(), nodeTestsDir);
  console.error(`No Node test files were found in ${searchTarget}.`);
  process.exit(1);
}

const child = spawn(process.execPath, ["-r", "sucrase/register/ts", "--test", ...testFiles], {
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
