#!/usr/bin/env node
/**
 * Repairs accidental duplicate /@shared/ segments in import paths after workspace migration.
 */
import fs from "node:fs";
import path from "node:path";

const roots = ["apps/web", "apps/desktop/electron", "packages/contracts/src"];

function fixSource(content) {
  let s = content;

  while (s.includes("@shared/shared/")) {
    s = s.replaceAll("@shared/shared/", "@shared/");
  }

  s = s.replaceAll("@shared/", "@trellis/shared/");

  // Collapse erroneous "/shared/" segments after @trellis/shared/ package root (module path only).
  s = s.replace(/(@trellis\/shared\/)([^"'`\s]+)/g, (_, pref, rest) => {
    let x = rest;
    while (x.includes("/shared/")) {
      x = x.replace("/shared/", "/");
    }
    return `${pref}${x}`;
  });

  // Relative imports corrupted to ../shared/lib/shared/ -> ../lib/
  s = s.replaceAll("../shared/lib/shared/", "../lib/");
  s = s.replaceAll("./shared/lib/shared/", "./lib/");
  s = s.replaceAll("./shared/types", "./types");

  // Collapse spurious "/shared/" segments in any relative import path (./* or ../*).
  s = s.replace(/from (["'])(\.\.?\/[^"']+)\1/g, (full, q, relPath) => {
    let x = relPath;
    while (x.includes("/shared/")) {
      x = x.replace("/shared/", "/");
    }
    return `from ${q}${x}${q}`;
  });

  return s;
}

function walk(dir, fn) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      walk(p, fn);
    } else if (/\.(ts|tsx|mts|cts)$/.test(name)) {
      fn(p);
    }
  }
}

for (const root of roots) {
  const abs = path.resolve(root);
  if (!fs.existsSync(abs)) {
    continue;
  }
  walk(abs, (filePath) => {
    const before = fs.readFileSync(filePath, "utf8");
    const after = fixSource(before);
    if (after !== before) {
      fs.writeFileSync(filePath, after);
    }
  });
}
