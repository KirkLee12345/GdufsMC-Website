import Link from "next/link";
import { getBingoTeams } from "@/lib/bingo/teams";

export const dynamic = "force-dynamic";

const TEAM_STYLES: Record<string, string> = {
  红: "border-red-200 bg-red-50 text-red-700",
  蓝: "border-blue-200 bg-blue-50 text-blue-700",
  绿: "border-emerald-200 bg-emerald-50 text-emerald-700",
  黄: "border-amber-200 bg-amber-50 text-amber-700",
  橙: "border-orange-200 bg-orange-50 text-orange-700",
  粉: "border-pink-200 bg-pink-50 text-pink-700",
  青: "border-cyan-200 bg-cyan-50 text-cyan-700",
  灰: "border-slate-200 bg-slate-50 text-slate-700",
};

export default async function BingoTeamsPage() {
  const data = await getBingoTeams();
  return (
    <div className="min-h-[70vh] bg-slate-50 px-4 pb-16 pt-28 sm:px-6 sm:pt-32">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-600">BINGO TOURNAMENT</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{data.title}</h1>
            <p className="mt-3 text-slate-600">{data.subtitle}</p>
            {data.updatedAt && <p className="mt-1 text-xs text-slate-400">更新于 {data.updatedAt}</p>}
          </div>
          <Link href="/news/questionnaire" className="text-sm font-medium text-emerald-700 hover:text-emerald-900">返回赛前调查 →</Link>
        </div>
        {data.teams.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center text-slate-500">队伍名单尚未公布，请稍后再来查看。</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.teams.map((team) => (
              <section key={team.id} className={`rounded-2xl border p-5 ${TEAM_STYLES[team.color] ?? TEAM_STYLES.灰}`}>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl font-bold">{team.name}</h2>
                  <span className="rounded-full bg-white/70 px-2 py-1 text-xs font-semibold">{team.members.length} 人</span>
                </div>
                <ul className="mt-5 space-y-2 text-sm text-slate-700">
                  {team.members.map((member) => <li key={member} className="rounded-lg bg-white/70 px-3 py-2">{member}</li>)}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
