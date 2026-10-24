export const BINGO_EXPERIENCE_OPTIONS = [
  { value: "0", label: "0 场，从未玩过" },
  { value: "1-9", label: "1—9 场" },
  { value: "10-19", label: "10—19 场" },
  { value: "20-49", label: "20—49 场" },
  { value: "50-99", label: "50—99 场" },
  { value: "100+", label: "100 场及以上" },
] as const;

export const BINGO_VERSION_OPTIONS = [
  { value: "none", label: "基本不了解", description: "没接触过，也不了解新增内容" },
  { value: "aware", label: "略有了解", description: "看过介绍或视频，但缺少实际游玩经验" },
  { value: "familiar", label: "比较熟悉", description: "实际玩过，能独立完成常见的新版相关任务" },
  { value: "expert", label: "非常熟悉", description: "熟悉主要新增内容，能规划路线和处理复杂目标" },
] as const;

export const SURVIVAL_OPTIONS = [
  { value: "beginner", label: "需要队友指导", description: "对采集、合成和探索流程还不太熟悉" },
  { value: "independent", label: "能独立生存", description: "能独立完成常见采集、合成和探索任务" },
  { value: "advanced", label: "熟悉进阶流程", description: "熟悉下界、酿造、附魔等常见流程" },
  { value: "planner", label: "能规划复杂目标", description: "能较快拆解路线并推进复杂目标" },
] as const;

export type BingoExperience = (typeof BINGO_EXPERIENCE_OPTIONS)[number]["value"];
export type BingoVersion = (typeof BINGO_VERSION_OPTIONS)[number]["value"];
export type SurvivalLevel = (typeof SURVIVAL_OPTIONS)[number]["value"];

export interface BingoQuestionnaireSubmission {
  nickname: string;
  experience: BingoExperience;
  versionFamiliarity: BingoVersion;
  survivalLevel: SurvivalLevel;
  submittedAt: string;
}

export interface BingoTeam {
  id: number;
  color: string;
  name: string;
  members: string[];
}

export interface BingoTeamsData {
  title: string;
  subtitle: string;
  updatedAt?: string;
  teams: BingoTeam[];
}
