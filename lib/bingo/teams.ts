import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import { cache } from "react";
import type { BingoTeam, BingoTeamsData } from "./types";

const CONTENT_ROOT = process.env.CONTENT_ROOT
  ? join(process.env.CONTENT_ROOT, "content")
  : join(process.cwd(), "content");
const DATA_PATH = join(CONTENT_ROOT, "bingo-teams", "index.yml");

const DEFAULT_DATA: BingoTeamsData = {
  title: "Bingo 大赛分队结果",
  subtitle: "队伍名单尚未公布",
  teams: [],
};

export const getBingoTeams = cache(async (): Promise<BingoTeamsData> => {
  try {
    const parsed = yamlLoad(await readFile(DATA_PATH, "utf-8"));
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_DATA;
    const data = parsed as Record<string, unknown>;
    const rawTeams = Array.isArray(data.teams) ? data.teams : [];
    const teams = rawTeams
      .map(normalizeTeam)
      .filter((team): team is BingoTeam => team !== null)
      .sort((a, b) => a.id - b.id);
    return {
      title: typeof data.title === "string" ? data.title : DEFAULT_DATA.title,
      subtitle: typeof data.subtitle === "string" ? data.subtitle : DEFAULT_DATA.subtitle,
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : undefined,
      teams,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[bingo-teams] 读取失败:", error);
    }
    return DEFAULT_DATA;
  }
});

function normalizeTeam(value: unknown): BingoTeam | null {
  if (typeof value !== "object" || value === null) return null;
  const data = value as Record<string, unknown>;
  const id = Number(data.id);
  const color = typeof data.color === "string" ? data.color.trim() : "灰";
  const name = typeof data.name === "string" ? data.name.trim() : `${color}${id}`;
  const members = Array.isArray(data.members)
    ? data.members.filter((member): member is string => typeof member === "string").map((member) => member.trim()).filter(Boolean)
    : [];
  if (!Number.isInteger(id) || id < 1 || id > 8 || !name) return null;
  return { id, color, name, members };
}
