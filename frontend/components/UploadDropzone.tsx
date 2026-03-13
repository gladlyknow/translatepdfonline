"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";

export type UploadedFileStatus = "idle" | "uploading" | "uploaded" | "failed";

export type UploadedInfo = {
  name: string;
  size: number;
  status: UploadedFileStatus;
};

type Props = {
  onUploaded: (documentId: string, filename: string, sizeBytes: number, file?: File) => void;
  /** 最近一次上传的文件（如从列表恢复），用于始终显示在上传区域 */
  initialFile?: { name: string; size: number } | null;
};

export function UploadDropzone({ onUploaded, initialFile }: Props) {
  const t = useTranslations("upload");
  const tAuth = useTranslations("auth");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploadedInfo, setUploadedInfo] = useState<UploadedInfo | null>(null);
  const [loginHint, setLoginHint] = useState<string | null>(null);

  useEffect(() => {
    if (initialFile && !uploadedInfo) {
      setUploadedInfo({
        name: initialFile.name,
        size: initialFile.size,
        status: "uploaded",
      });
    }
  }, [initialFile, uploadedInfo]);

  const uploadFile = useCallback(
    async (file: File) => {
      if (file.type !== "application/pdf") {
        setError(t("selectPdfOnly"));
        return;
      }
      setUploading(true);
      setError(null);
      setLoginHint(null);
      setUploadedInfo({ name: file.name, size: file.size, status: "uploading" });
      setUploadProgress(0);
      const progressInterval = setInterval(() => {
        setUploadProgress((p) => Math.min(p + 12, 85));
      }, 200);
      try {
        const presigned = await api.createPresignedUpload(file.name, file.size);
        const putRes = await fetch(presigned.upload_url, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": "application/pdf" },
        });
        if (!putRes.ok) {
          throw new Error("Upload to storage failed");
        }
        clearInterval(progressInterval);
        setUploadProgress(100);
        const { document_id } = await api.completePresignedUpload(
          presigned.object_key,
          file.name,
          file.size
        );
        onUploaded(document_id, file.name, file.size, file);
        setUploadedInfo({ name: file.name, size: file.size, status: "uploaded" });
      } catch (e) {
        clearInterval(progressInterval);
        if (e instanceof Error && (e as any).status === 403) {
          const msg = (e as any).message || "";
          if (msg === "fingerprint_required") {
            setError(tAuth("fingerprintRequired"));
            setLoginHint(null);
            setUploadedInfo((prev) => (prev ? { ...prev, status: "failed" } : null));
            return;
          }
          if (msg === "login_required_for_multiple_documents") {
            setLoginHint(t("loginHintQuotaExceeded"));
            setError(null);
            setUploadedInfo(null);
            return;
          }
        }
        setError(e instanceof Error ? e.message : t("error"));
        setUploadedInfo((prev) => (prev ? { ...prev, status: "failed" } : null));
      } finally {
        setUploading(false);
        setUploadProgress(0);
      }
    },
    [onUploaded, t, tAuth]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    },
    [uploadFile]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) uploadFile(file);
      e.target.value = "";
    },
    [uploadFile]
  );

  const hasFile = !!uploadedInfo;
  const statusCopy =
    uploadedInfo?.status === "uploading"
      ? t("uploading")
      : uploadedInfo?.status === "uploaded"
        ? t("success")
        : uploadedInfo?.status === "failed"
          ? t("error")
          : "";

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors ${
        dragging
          ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
          : "border-zinc-300 bg-zinc-50 hover:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-900 dark:hover:border-zinc-500"
      }`}
    >
      <input
        type="file"
        accept="application/pdf"
        onChange={handleChange}
        disabled={uploading}
        className="hidden"
        id="pdf-upload"
      />
      <label
        htmlFor="pdf-upload"
        className="flex min-h-[44px] w-full cursor-pointer flex-col items-center justify-center gap-2 px-4 py-6"
      >
        {hasFile ? (
          <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-3 text-xs text-zinc-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-10 w-8 items-center justify-center rounded text-xs font-semibold ${
                  uploadedInfo.status === "failed"
                    ? "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300"
                    : "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300"
                }`}
              >
                PDF
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{uploadedInfo.name}</div>
                <div className="text-[11px] text-zinc-500">
                  {statusCopy}
                  {uploadedInfo.status !== "uploading" && (
                    <> · {uploadedInfo.size > 0 ? `${(uploadedInfo.size / 1024 / 1024).toFixed(2)} MB` : "— MB"}</>
                  )}
                </div>
              </div>
            </div>
            {uploadedInfo.status === "uploading" && (
              <div className="mt-3">
                <div className="mb-1 h-1 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                  <div
                    className="h-1 rounded-full bg-blue-500 transition-[width] duration-300 dark:bg-blue-400"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-[11px] text-zinc-500">{t("uploading")}</p>
              </div>
            )}
          </div>
        ) : (
          <>
            <span className="text-center text-zinc-600 dark:text-zinc-400">
              {t("dropzone")}
            </span>
            {error && (
              <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
            )}
          </>
        )}
      </label>
      {hasFile && error && uploadedInfo?.status === "failed" && (
        <p className="mt-1 max-w-md px-2 text-center text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {loginHint && (
        <div className="mt-3 w-full max-w-md rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/40 dark:bg-amber-900/30 dark:text-amber-100">
          {loginHint}
        </div>
      )}
    </div>
  );
}
