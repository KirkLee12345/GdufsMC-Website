import Link from "next/link";
import { QuestionnaireForm } from "@/components/bingo/questionnaire-form";

export const dynamic = "force-dynamic";

export default function QuestionnairePage() {
  return (
    <div className="min-h-[70vh] bg-slate-50 px-4 pb-16 pt-28 sm:px-6 sm:pt-32">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-600">BINGO TOURNAMENT</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">赛前调查</h1>
          <p className="mt-3 max-w-2xl leading-7 text-slate-600">请按实际情况填写。调查结果只用于分队，帮助每支队伍尽量兼顾 Bingo 经验、版本熟悉度和生存能力。</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <QuestionnaireForm />
        </div>
        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          <Link href="/bingo-teams" className="font-medium text-emerald-700 hover:text-emerald-900">查看分队结果 →</Link>
          <span className="text-slate-400">结果公布后开放</span>
        </div>
      </div>
    </div>
  );
}
