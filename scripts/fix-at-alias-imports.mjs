#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function collapseSharedInAtImports(content) {
  let s = content;

  s = s.replace(/\bfrom (["'])@\/([^"']+)\1/g, (full, q, rest) => {
    let x = rest;
    while (x.includes("/shared/")) {
      x = x.replace("/shared/", "/");
    }
    return `from ${q}@/${x}${q}`;
  });

  s = s.replace(/\bimport\((["'])@\/([^"']+)\1/g, (full, q, rest) => {
    let x = rest;
    while (x.includes("/shared/")) {
      x = x.replace("/shared/", "/");
    }
    return `import(${q}@/${x}${q}`;
  });

  return s;
}

function walk(dir, fn) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      walk(p, fn);
    } else if (/\.(ts|tsx)$/.test(name)) {
      fn(p);
    }
  }
}

const root = path.resolve("apps/web/src");
walk(root, (filePath) => {
  const before = fs.readFileSync(filePath, "utf8");
  const after = collapseSharedInAtImports(before);
  if (after !== before) {
    fs.writeFileSync(filePath, after);
  }
});
