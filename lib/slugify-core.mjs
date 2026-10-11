/**
 * DO NOT MOVE THIS FILE — the path is a production deployment contract.
 *
 * 冻结文件: 路径和层级不可改动。
 *
 * 原因: 本文件是 content-tools 固定工具的 payload 之一, 硬编码在
 * scripts/package-content-tools.mjs 的 CONTENT_TOOL_FILES 里, 会被打包
 * 安装到生产服务器 H:\GDUFSMC-content-tools\。服务器上的工具用相对路径
 *   ../lib/slugify-core.mjs
 * 导入它 (scripts/content-sync.mjs、scripts/verify-content-root.mjs)。
 *
 * 移动本文件或改变 lib/ 与 scripts/ 的相对层级, 会让已安装的服务器端工具
 * 与新包布局分裂 —— 表现为内容同步/校验在服务器上直接 MODULE_NOT_FOUND。
 *
 * 2026-10-11: lib/ 按 global/news/map 重组时, 本文件被有意留在 lib/ 根,
 * 是 lib/ 下唯一不进子目录的文件。旁边的 lib/news/slugify.ts 是 TS 包装层,
 * 可以自由移动。
 */
import { pinyin } from "pinyin-pro";

/**
 * Shared title-to-slug implementation for the application and Node scripts.
 * @param {string} title
 * @returns {string}
 */
export function slugify(title) {
  if (!title || typeof title !== "string") return "untitled";

  // pinyin-pro: 中文 → 拼音 (无音调), ASCII 字母数字原样保留 (nonZh: "consecutive")
  //   "欢迎来到：云城像素社 Alpha 内测" → "huan ying lai dao ： yun cheng xiang su she Alpha nei ce"
  // type: "string" 返回拼接好的字符串
  const romanized = pinyin(title, {
    toneType: "none",
    type: "string",
    nonZh: "consecutive",
  });

  return (
    romanized
      .toLowerCase()
      // 非字母数字 (中文标点、emoji、空格) 全转 dash
      .replace(/[^a-z0-9]+/g, "-")
      // 收尾 dash 去掉
      .replace(/^-+|-+$/g, "")
      // 连续 dash 合并
      .replace(/-{2,}/g, "-") || "untitled"
  );
}
