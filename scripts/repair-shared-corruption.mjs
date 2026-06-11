#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const roots = ["apps/web/src", "packages/contracts/src", "packages/shared/src"];

function repair(content, opts) {
  let s = content;
  if (opts.comments) {
    s = s.replace(/\/shared\/\*\*/g, "/**");
    s = s.replace(/\*\/shared\//g, "*/");
    s = s.replace(/\/shared\/\/shared\//g, "//");
  }
  if (opts.jsx) {
    s = s.replace(/\/shared\/>/g, "/>");
    s = s.replace(/<\/shared\//g, "</");
    s = s.replace(/bg-trellis-border\/shared\//g, "bg-trellis-border/");
    s = s.replace(/border-trellis-accent\/shared\//g, "border-trellis-accent/");
  }
  if (opts.cloudClient) {
    s = s.replace(/\/shared\/functions\/shared\/v1/g, "/functions/v1");
    s = s.replace(/application\/shared\/json/g, "application/json");
    s = s.replace(/\$\{functionsBaseUrl\}\/shared\//g, "${functionsBaseUrl}/");
  }
  if (opts.importAliases) {
    s = s.replace(/@electron\/shared\/ipc\/shared\/types/g, "@trellis/contracts");
    s = s.replace(/@electron\/contracts/g, "@trellis/contracts");
    s = s.replace(/@supabase\/shared\/supabase-js/g, "@supabase/supabase-js");
  }
  return s;
}

function walk(dir, fn) {
  if (!fs.existsSync(dir)) {
    return;
  }
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

for (const root of roots) {
  walk(path.resolve(root), (filePath) => {
    const isClient = filePath.endsWith(`cloud${path.sep}client.ts`);
    const before = fs.readFileSync(filePath, "utf8");
    const after = repair(before, {
      comments: true,
      jsx: filePath.endsWith(".tsx"),
      cloudClient: isClient,
      importAliases: true
    });
    if (after !== before) {
      fs.writeFileSync(filePath, after);
    }
  });
}

const desktopRoot = path.resolve("apps/desktop/electron");
walk(desktopRoot, (filePath) => {
  let s = fs.readFileSync(filePath, "utf8");
  const before = s;
  s = s.replace(/from "\/shared\//g, 'from "@trellis/shared/');
  s = s.replace(/\/shared\/\/shared\//g, "//");
  s = s.replace(/\/shared\/\*\*/g, "/**");
  s = s.replace(/\*\/shared\//g, "*/");
  if (s !== before) {
    fs.writeFileSync(filePath, s);
  }
});
