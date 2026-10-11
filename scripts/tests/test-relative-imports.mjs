/**
 * 目录重组守门员: 每一条相对 import 都必须能解析到真实文件。
 *
 * 为什么需要它:
 * tsc --noEmit 不检查 .mjs 的 import, eslint 不查模块解析, 而
 * scripts/build/package-release.mjs 这类打包脚本只有 CI 才会真正执行。
 * 2026-10-11 就是这样漏的: 该脚本从 scripts/ 移到 scripts/build/ 后,
 * `from "./content-snapshot.mjs"` 没跟着改成 "../", 本地全绿, CI 挂了。
 *
 * 检查方式:
 * - 只认行首为 import/export 的语句 (向上回溯, 支持多行 import)。
 *   模板字符串里的 "import x from './y.mjs'" 行首是赋值语句, 不会被误判。
 * - TypeScript 允许省略扩展名, 解析失败时依次补 .ts / .tsx / .mjs / .js。
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIRS = ["scripts", "lib", "components", "app", "data"];
const EXTS = new Set([".ts", ".tsx", ".mjs", ".js"]);
const CANDIDATE_EXT = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"];

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (EXTS.has(name.slice(name.lastIndexOf(".")))) acc.push(p);
  }
  return acc;
}

/** 该行是否处于一条 import/export 语句内 (向上回溯到语句起始) */
function insideImportStatement(lines, index) {
  for (let j = index; j >= 0; j--) {
    const t = lines[j].trim();
    if (t === "" || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
    return /^(import|export)\b/.test(t);
  }
  return false;
}

function collect() {
  const problems = [];
  let checked = 0;
  for (const d of DIRS) {
    const abs = join(ROOT, d);
    if (!existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const rel = relative(ROOT, file);
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const m = /\bfrom\s*["'](\.\.?\/[^"']+)["']/.exec(lines[i]);
        if (!m) continue;
        if (!insideImportStatement(lines, i)) continue; // 模板字符串/字符串拼接
        const spec = m[1];
        if (spec.includes("${")) continue;
        checked++;
        const base = resolve(dirname(file), spec);
        const ok = CANDIDATE_EXT.some((e) => existsSync(base + e));
        if (!ok) problems.push(`${rel}:${i + 1}  ${spec}`);
      }
    }
  }
  return { checked, problems };
}

test("every relative import resolves to a real file", () => {
  const { checked, problems } = collect();
  if (problems.length) {
    throw new Error(
      `${problems.length} 条相对 import 解析失败（目录重组时最容易漏）:\n  ` +
        problems.join("\n  "),
    );
  }
  assert.ok(checked > 0, "应当至少检查到一条相对 import, 否则扫描范围写坏了");
});

import assert from "node:assert/strict";
