import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BingoQuestionnaireSubmission } from "./types";

const SUBMISSIONS_PATH = process.env.BINGO_SUBMISSIONS_PATH
  ? process.env.BINGO_SUBMISSIONS_PATH
  : join(process.cwd(), "data", "bingo-questionnaire-submissions.json");

let writeQueue: Promise<void> = Promise.resolve();

async function readSubmissions(): Promise<BingoQuestionnaireSubmission[]> {
  try {
    const raw = await readFile(SUBMISSIONS_PATH, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BingoQuestionnaireSubmission[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function saveSubmission(submission: BingoQuestionnaireSubmission): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    const submissions = await readSubmissions();
    submissions.push(submission);
    await mkdir(dirname(SUBMISSIONS_PATH), { recursive: true });
    await writeFile(SUBMISSIONS_PATH, `${JSON.stringify(submissions, null, 2)}\n`, "utf-8");
  });
  return writeQueue;
}
