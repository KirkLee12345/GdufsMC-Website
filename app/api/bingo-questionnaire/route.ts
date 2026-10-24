import { NextResponse } from "next/server";
import { saveSubmission } from "@/lib/bingo/submissions";
import {
  BINGO_EXPERIENCE_OPTIONS,
  BINGO_VERSION_OPTIONS,
  SURVIVAL_OPTIONS,
  type BingoQuestionnaireSubmission,
} from "@/lib/bingo/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const validValues: Record<"experience" | "versionFamiliarity" | "survivalLevel", Set<string>> = {
  experience: new Set(BINGO_EXPERIENCE_OPTIONS.map((option) => option.value)),
  versionFamiliarity: new Set(BINGO_VERSION_OPTIONS.map((option) => option.value)),
  survivalLevel: new Set(SURVIVAL_OPTIONS.map((option) => option.value)),
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
    const experience = typeof body.experience === "string" ? body.experience : "";
    const versionFamiliarity = typeof body.versionFamiliarity === "string" ? body.versionFamiliarity : "";
    const survivalLevel = typeof body.survivalLevel === "string" ? body.survivalLevel : "";

    if (!nickname || nickname.length > 24) return NextResponse.json({ error: "请填写 1—24 个字符的玩家昵称" }, { status: 400 });
    if (!validValues.experience.has(experience)) return NextResponse.json({ error: "请选择 Bingo 经验" }, { status: 400 });
    if (!validValues.versionFamiliarity.has(versionFamiliarity)) return NextResponse.json({ error: "请选择版本熟悉程度" }, { status: 400 });
    if (!validValues.survivalLevel.has(survivalLevel)) return NextResponse.json({ error: "请选择生存熟练程度" }, { status: 400 });

    const submission: BingoQuestionnaireSubmission = {
      nickname,
      experience: experience as BingoQuestionnaireSubmission["experience"],
      versionFamiliarity: versionFamiliarity as BingoQuestionnaireSubmission["versionFamiliarity"],
      survivalLevel: survivalLevel as BingoQuestionnaireSubmission["survivalLevel"],
      submittedAt: new Date().toISOString(),
    };
    await saveSubmission(submission);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "提交失败，请稍后重试" }, { status: 500 });
  }
}
