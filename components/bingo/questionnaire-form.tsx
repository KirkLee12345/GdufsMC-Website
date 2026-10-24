"use client";

import { FormEvent, useState } from "react";
import {
  BINGO_EXPERIENCE_OPTIONS,
  BINGO_VERSION_OPTIONS,
  SURVIVAL_OPTIONS,
} from "@/lib/bingo/types";

const inputClassName = "mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[0.95rem] text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100";
const choiceClassName = "flex cursor-pointer gap-3 rounded-xl border border-slate-200 bg-white p-3 transition has-[:checked]:border-emerald-400 has-[:checked]:bg-emerald-50";

export function QuestionnaireForm() {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setErrorMessage("");
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const response = await fetch("/api/bingo-questionnaire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "提交失败，请稍后重试");
      setStatus("success");
      form.reset();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "提交失败，请稍后重试");
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-7">
      <label className="block">
        <span className="font-semibold text-slate-800">玩家昵称</span>
        <span className="mt-1 block text-sm text-slate-500">填写比赛时希望使用的昵称。</span>
        <input className={inputClassName} name="nickname" maxLength={24} required placeholder="例如：Steve" />
      </label>

      <fieldset>
        <legend className="font-semibold text-slate-800">1. 你累计参加过多少场 Bingo？</legend>
        <p className="mt-1 text-sm text-slate-500">只统计规则相近的 Bingo 玩法。</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {BINGO_EXPERIENCE_OPTIONS.map((option) => (
            <label key={option.value} className={choiceClassName}>
              <input className="mt-1 accent-emerald-500" type="radio" name="experience" value={option.value} required />
              <span className="text-sm text-slate-700">{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="font-semibold text-slate-800">2. 你对本次比赛使用的新版本有多熟悉？</legend>
        <div className="mt-3 grid gap-2">
          {BINGO_VERSION_OPTIONS.map((option) => (
            <label key={option.value} className={choiceClassName}>
              <input className="mt-1 accent-emerald-500" type="radio" name="versionFamiliarity" value={option.value} required />
              <span><span className="block text-sm font-medium text-slate-700">{option.label}</span><span className="block text-xs text-slate-500">{option.description}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="font-semibold text-slate-800">3. 你的 Minecraft 原版生存熟练程度如何？</legend>
        <div className="mt-3 grid gap-2">
          {SURVIVAL_OPTIONS.map((option) => (
            <label key={option.value} className={choiceClassName}>
              <input className="mt-1 accent-emerald-500" type="radio" name="survivalLevel" value={option.value} required />
              <span><span className="block text-sm font-medium text-slate-700">{option.label}</span><span className="block text-xs text-slate-500">{option.description}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={status === "submitting"} className="rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-wait disabled:opacity-60">
          {status === "submitting" ? "提交中…" : "提交调查"}
        </button>
        {status === "success" && <p role="status" className="text-sm font-medium text-emerald-700">已收到你的调查，感谢参与！</p>}
        {status === "error" && <p role="alert" className="text-sm font-medium text-rose-600">{errorMessage}</p>}
      </div>
    </form>
  );
}
