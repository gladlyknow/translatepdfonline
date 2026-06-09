"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { LanguageSelector } from "./LanguageSelector";
import { api, type UILang } from "@/lib/api";
import { slicePdfByPageRange } from "@/lib/pdfSlice";

type Props = {
  documentId: string;
  onTaskCreated: (taskId: string) => void;
  /** 与 Upload 同一行时使用紧凑单行布局 */
  compact?: boolean;
  /** 当前任务状态：queued/processing 时禁用按钮，防止重复点击；completed/failed 后还原 */
  taskStatus?: string | null;
  /** 最近一次上传的 PDF 文件（用于按页切分后上传切片，后端直接消费切片） */
  sourceFileRef?: React.RefObject<File | null>;
};

export function TranslationForm({ documentId, onTaskCreated, compact = false, taskStatus = null, sourceFileRef }: Props) {
  const t = useTranslations("translate");
  const tAuth = useTranslations("auth");
  const tLang = useTranslations("languages");
  const [sourceLang, setSourceLang] = useState<UILang | "">("");
  const [targetLang, setTargetLang] = useState<UILang | "">("");
  const [pageRange, setPageRange] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginHint, setLoginHint] = useState<string | null>(null);

  const taskInProgress = taskStatus === "queued" || taskStatus === "processing";
  const submitDisabled = submitting || taskInProgress || !sourceLang || !targetLang;

  // 尝试从 PDF 首页自动检测源语言（仅在有文件时，检测失败则保持为空）
  useEffect(() => {
    const file = sourceFileRef?.current;
    if (!file || sourceLang) return;

    let cancelled = false;
    const detect = async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const data = await file.arrayBuffer();
        const loadingTask = pdfjs.getDocument({ data });
        const doc = await loadingTask.promise;
        const page = await doc.getPage(1);
        const textContent = await page.getTextContent();
        const text = textContent.items
          .map((it: any) => (typeof it.str === "string" ? it.str : ""))
          .join(" ")
          .slice(0, 2000);
        if (!text.trim()) return;
        // 非严格语言检测：简单按字符范围/关键字判断 zh/en/es
        let detected: UILang | null = null;
        const hasCJK = /[\u4e00-\u9fff]/.test(text);
        if (hasCJK) {
          detected = "zh";
        } else {
          const lower = text.toLowerCase();
          const esHints = [" que ", " de ", " el ", " la ", " los ", " las ", " un ", " una "];
          const enHints = [" the ", " and ", " of ", " to ", " in "];
          const esScore = esHints.filter((h) => lower.includes(h)).length;
          const enScore = enHints.filter((h) => lower.includes(h)).length;
          if (esScore > enScore && esScore >= 2) detected = "es";
          else if (enScore >= 2) detected = "en";
        }
        if (!cancelled && detected && !sourceLang) {
          setSourceLang(detected);
        }
      } catch {
        // 检测失败时静默忽略，保持为空
      }
    };
    detect();
    return () => {
      cancelled = true;
    };
  }, [documentId, sourceFileRef, sourceLang]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceLang || !targetLang) {
      setError(t("selectBothLanguages"));
      return;
    }
    if (sourceLang === targetLang) {
      setError(t("sameLangError"));
      return;
    }
    setSubmitting(true);
    setError(null);
    setLoginHint(null);
    const rangeTrimmed = pageRange?.trim() || undefined;

    try {
      let sourceSliceObjectKey: string | undefined;
      if (rangeTrimmed && sourceFileRef?.current) {
        try {
          const presigned = await api.getPresignedSlice(documentId, rangeTrimmed);
          const sliceBlob = await slicePdfByPageRange(sourceFileRef.current, rangeTrimmed);
          const putRes = await fetch(presigned.upload_url, {
            method: "PUT",
            body: sliceBlob,
            headers: { "Content-Type": "application/pdf" },
          });
          if (putRes.ok) {
            sourceSliceObjectKey = presigned.slice_object_key;
          }
        } catch (_) {
          // R2 未配置或切片失败时回退为后端按页切分
        }
      }

      const { task_id } = await api.translate(
        documentId,
        sourceLang as UILang,
        targetLang as UILang,
        rangeTrimmed,
        sourceSliceObjectKey,
        false
      );
      onTaskCreated(task_id);
    } catch (e) {
      if (e instanceof Error && (e as any).status === 403) {
        const msg = (e as any).message || "";
        if (msg === "fingerprint_required") {
          setError(tAuth("fingerprintRequired"));
          setLoginHint(null);
          return;
        }
        if (msg === "free_quota_exceeded_login_required") {
          setLoginHint(t("loginHintQuotaExceeded"));
          setError(null);
          return;
        }
      }
      setError(e instanceof Error ? e.message : t("createTaskFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  if (compact) {
    return (
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="w-full sm:w-auto">
          <LanguageSelector
            value={sourceLang}
            onChange={setSourceLang}
            label={t("sourceLang")}
            placeholderKey="selectSourceLang"
          />
        </div>
        <span className="shrink-0 text-zinc-400 dark:text-zinc-500" aria-hidden>↔</span>
        <div className="w-full sm:w-auto">
          <LanguageSelector
            value={targetLang}
            onChange={setTargetLang}
            label={t("targetLang")}
            placeholderKey="selectTargetLang"
          />
        </div>
        {sourceLang && targetLang ? (
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400 w-full sm:w-auto">
            {t("confirmDirection", {
              source: tLang(sourceLang as UILang),
              target: tLang(targetLang as UILang),
            })}
          </span>
        ) : (
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400 w-full sm:w-auto">
            {t("selectBothLanguages")}
          </span>
        )}
        <input
          type="text"
          value={pageRange}
          onChange={(e) => setPageRange(e.target.value)}
          placeholder={t("pageRangeExample")}
          className="min-h-[44px] w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base sm:w-32 dark:border-zinc-600 dark:bg-zinc-800"
          aria-label={t("pageRange")}
        />
        {(error || loginHint) && (
          <span className={`text-sm w-full sm:w-auto ${error ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-300"}`}>
            {error ?? loginHint}
          </span>
        )}
        <button
          type="submit"
          disabled={submitDisabled}
          className="min-h-[44px] w-full shrink-0 rounded-xl bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 sm:w-auto"
        >
          {submitting ? t("submitting") : taskInProgress ? t("submitting") : t("submit")}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <LanguageSelector
          value={sourceLang}
          onChange={setSourceLang}
          label={t("sourceLang")}
          placeholderKey="selectSourceLang"
        />
        <LanguageSelector
          value={targetLang}
          onChange={setTargetLang}
          label={t("targetLang")}
          placeholderKey="selectTargetLang"
        />
      </div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">
        {sourceLang && targetLang
          ? t("confirmDirection", {
              source: tLang(sourceLang as UILang),
              target: tLang(targetLang as UILang),
            })
          : t("selectBothLanguages")}
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          {t("pageRange")}
        </label>
        <input
          type="text"
          value={pageRange}
          onChange={(e) => setPageRange(e.target.value)}
          placeholder={t("pageRangeExample")}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        />
      </div>
      {error && (
        <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
      )}
      {loginHint && (
        <span className="text-sm text-amber-700 dark:text-amber-300">
          {loginHint}
        </span>
      )}
      <button
        type="submit"
        disabled={submitDisabled}
        className="min-h-[44px] rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? t("submitting") : taskInProgress ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
