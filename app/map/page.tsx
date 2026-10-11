import { GuideMap } from "@/components/map/guide-map";
import { MapTabs } from "@/components/map/map-tabs";
import { loadMapData } from "@/lib/map/loader";

/**
 * Map 页 — 导览地图 (GuideMap) + 群系地图 tabs
 * - server component: 读 public/images/maps/20260907/ 拼成 NewWorldMeta[]
 * - client component: <GuideMap worlds={...} /> 接管 zoom/pan/fullscreen
 * - 顶部 tabs 跟 /map 页共用 MapTabs, 群系地图 tab 标题右侧带短 URL
 * - 地标(labels)和交通(transit)数据由 GuideMap 自己在 client 侧 import,
 *   不在这里当 props 传 —— 否则 2000 行坐标会被序列化进 RSC flight payload
 *   写进 HTML, 实测占 map.html 的 61%。详见 guide-map.tsx 里的说明。
 */
export default function NewGuideMapPage() {
  const worlds = loadMapData();

  return (
    <div className="pt-28 sm:pt-34 pb-12 sm:pb-16 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      <div className="mx-auto max-w-7xl">
        <MapTabs />
        <div className="sm:mt-12">
          <GuideMap worlds={worlds} />
        </div>
      </div>
    </div>
  );
}
