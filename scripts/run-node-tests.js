"use strict";

/**
 * Corre `node --test` com todos os `*.test.js` em `tests/`.
 * Evita `node --test tests/` em algumas versões/OS onde a pasta é tratada como módulo.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const testsDir = path.join(__dirname, "..", "tests");
if (!fs.existsSync(testsDir)) {
  console.error("Pasta tests/ não encontrada em", testsDir);
  process.exit(1);
}

const files = fs
  .readdirSync(testsDir)
  .filter((f) => f.endsWith(".test.js"))
  .map((f) => path.join(testsDir, f))
  .sort();

if (files.length === 0) {
  console.error("Nenhum ficheiro *.test.js em tests/");
  process.exit(1);
}

const r = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
  windowsHide: true
});

process.exit(r.status === null ? 1 : r.status);
