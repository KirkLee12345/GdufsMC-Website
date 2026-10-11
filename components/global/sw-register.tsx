"use client";

/**
 * Service Worker 注册 —— 当前已停用 (2026-10-11)
 *
 * 为什么停用:
 * SW 的 fetch handler 只缓存 /images/maps/*, 用 cache-first, 而且 Cache API
 * **没有 TTL** —— 命中就直接返回, 根本不发请求。也就是说对装过 SW 的浏览器,
 * 源站写的 max-age / s-maxage 全部失效, 改地图图片后老用户可能一直看不到新版,
 * 除非手动 bump public/sw.js 的 CACHE_VERSION。
 *
 * 停用后缓存职责回到源站 + CDN:
 *   浏览器  max-age=180  (3 分钟)
 *   EdgeOne s-maxage=259200 (3 天)
 * 见 Caddyfile 的 @publicImages handle。
 *
 * 另外注意: 这个组件此前从未被 app/layout.tsx 挂载, 所以 SW 在生产上
 * 实际从未注册过。停用它不会改变任何现有用户的行为, 只是让代码与事实一致。
 *
 * 恢复方法: 把 ENABLED 改回 true 即可 (layout.tsx 已经挂载本组件),
 * 但要同时:
 *   1. bump public/sw.js 的 CACHE_VERSION (v1 -> v2), 否则老缓存不会失效
 *   2. 决定要不要给地图图片加版本化文件名, 否则 bump 后仍要等用户重新访问
 */

import { useEffect } from "react";
import { logger } from "@/lib/global/logger";

/** SW 总开关。停用时挂载本组件反而会主动注销并清理遗留缓存。 */
const ENABLED = false;

/** 与 public/sw.js 的 CACHE_PREFIX 保持一致, 便于一并清理。 */
const CACHE_PREFIX = "mc-maps-";

export function SwRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (!("caches" in window)) return;

    if (ENABLED) {
      // 等 load 事件, 不抢首次渲染
      const onLoad = () => {
        navigator.serviceWorker
          .register("/sw.js", { scope: "/" })
          .then((reg) => {
            logger.debug("[SW] registered", { scope: reg.scope });
          })
          .catch((err) => {
            logger.warn("[SW] registration failed", err);
          });
      };

      if (document.readyState === "complete") {
        onLoad();
      } else {
        window.addEventListener("load", onLoad, { once: true });
        return () => window.removeEventListener("load", onLoad);
      }
      return;
    }

    // 停用路径: 注销所有注册 + 删掉遗留 cache。
    // 这对当前未注册过的新用户是空操作, 但能兜住从曾注册过 SW 的版本过来的老用户。
    const cleanup = async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => caches.delete(k)),
      );
      if (regs.length || keys.some((k) => k.startsWith(CACHE_PREFIX))) {
        logger.info("[SW] disabled — unregistered and cleared caches", {
          registrations: regs.length,
        });
      }
    };

    cleanup().catch((err) => {
      logger.warn("[SW] cleanup failed", err);
    });
  }, []);

  return null;
}
