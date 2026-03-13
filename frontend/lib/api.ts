// 浏览器端：有 NEXT_PUBLIC_API_BASE_URL 时直连后端（静态导出/Cloudflare）；否则同源由 next 代理。服务端构建用 env。
const API_BASE =
  typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_API_BASE_URL || "")
    : (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000");

/** 将相对 API 路径解析为完整 URL（静态导出时前端直连后端用） */
export function resolveApiUrl(url: string): string {
  if (!url || url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${API_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

export type UILang = "zh" | "en" | "es";

export interface DocumentSummary {
  id: string;
  filename: string;
  size_bytes: number;
  status: string;
  created_at: string;
}

export interface TaskSummary {
  id: string;
  document_id: string;
  status: string;
  source_lang: string;
  target_lang: string;
  created_at: string;
  document_filename?: string | null;
  page_range?: string | null;
  updated_at?: string | null;
}

export interface TaskDetail {
  id: string;
  document_id: string;
  source_lang: string;
  target_lang: string;
  page_range: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  error_code?: string | null;
  error_message?: string | null;
  progress_percent?: number | null;
  progress_stage?: string | null;
  progress_current?: number | null;
  progress_total?: number | null;
}

export interface TranslateResponse {
  task_id: string;
}

export interface PresignedUploadResponse {
  upload_url: string;
  object_key: string;
  expires_at: string;
}

export interface InitMultipartResponse {
  upload_id: string;
  bucket: string;
  key: string;
  region: string;
}

export interface CompleteMultipartResponse {
  document_id: string;
}

export interface TaskOutputFile {
  filename: string;
  download_url: string;
}

export interface ApiError {
  status: number;
  detail?: string;
}

export interface UserMeResponse {
  id: string;
  email?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
}

export interface TaskView {
  task: TaskDetail;
  document_filename: string;
  /** 原始文档大小（字节），刷新后恢复上传区显示用 */
  document_size_bytes?: number;
  outputs: TaskOutputFile[];
  /** 译文主文件 URL（不含文件名，供 PDF 预览用，避免编码 404） */
  primary_file_url?: string | null;
  source_pdf_url?: string | null;
  /** 当前用户是否允许下载（临时用户仅可预览） */
  can_download?: boolean;
}

import { getFingerprint } from "./fingerprint";

let sessionTokenCache: string | null = null;

export async function getSessionToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (sessionTokenCache) return sessionTokenCache;
  try {
    const { getSession } = await import("next-auth/react");
    const session = await getSession();
    const token = (session as { backend_access_token?: string } | null)?.backend_access_token ?? null;
    if (typeof token === "string") {
      sessionTokenCache = token;
      return token;
    }
  } catch {
    // ignore
  }
  return null;
}

export function clearSessionTokenCache() {
  sessionTokenCache = null;
}

async function fetchApi<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (typeof window !== "undefined") {
    try {
      const fp = await getFingerprint();
      if (fp) headers["X-Client-Fingerprint"] = fp;
    } catch {
      // 指纹获取失败不影响请求
    }
    if (!path.startsWith("/api/auth/")) {
      const token = await getSessionToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }
  }
  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers,
  });
  if (!res.ok) {
    if (res.status === 401) clearSessionTokenCache();
    const err = await res.json().catch(() => ({}));
    const apiError: ApiError = {
      status: res.status,
      detail: err.detail || res.statusText || "Request failed",
    };
    const error = new Error(apiError.detail) as Error & { status?: number };
    error.status = apiError.status;
    throw error;
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  listDocuments: () =>
    fetchApi<DocumentSummary[]>(`/api/documents`),

  deleteDocument: (documentId: string) =>
    fetchApi<void>(`/api/documents/${documentId}`, { method: "DELETE" }),

  createPresignedUpload: (filename: string, sizeBytes: number) =>
    fetchApi<PresignedUploadResponse>(`/api/upload/presigned`, {
      method: "POST",
      body: JSON.stringify({
        filename,
        size_bytes: sizeBytes,
        content_type: "application/pdf",
      }),
    }),

  initMultipart: (filename: string, sizeBytes: number) =>
    fetchApi<InitMultipartResponse>(`/api/upload/multipart/init`, {
      method: "POST",
      body: JSON.stringify({
        filename,
        size_bytes: sizeBytes,
        content_type: "application/pdf",
      }),
    }),

  completeMultipart: (
    uploadId: string,
    key: string,
    filename: string,
    sizeBytes: number
  ) =>
    fetchApi<CompleteMultipartResponse>(`/api/upload/multipart/complete`, {
      method: "POST",
      body: JSON.stringify({
        upload_id: uploadId,
        key,
        filename,
        size_bytes: sizeBytes,
      }),
    }),

  directUpload: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const url = `${API_BASE || ""}/api/upload/direct`;
    const headers: Record<string, string> = {};
    if (typeof window !== "undefined") {
      try {
        const fp = await getFingerprint();
        if (fp) headers["X-Client-Fingerprint"] = fp;
      } catch {
        /* ignore */
      }
    }
    const res = await fetch(url, {
      method: "POST",
      body: form,
      credentials: "include",
      headers,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || res.statusText || "Upload failed");
    }
    return res.json() as Promise<CompleteMultipartResponse>;
  },

  getPresignedSlice: (documentId: string, pageRange: string) =>
    fetchApi<{ upload_url: string; slice_object_key: string; expires_at: string }>(
      `/api/upload/presigned-slice`,
      {
        method: "POST",
        body: JSON.stringify({ document_id: documentId, page_range: pageRange }),
      }
    ),

  translate: (
    documentId: string,
    sourceLang: UILang,
    targetLang: UILang,
    pageRange?: string,
    sourceSliceObjectKey?: string,
    preprocessWithOcr?: boolean
  ) =>
    fetchApi<TranslateResponse>(`/api/translate`, {
      method: "POST",
      body: JSON.stringify({
        document_id: documentId,
        source_lang: sourceLang,
        target_lang: targetLang,
        page_range: pageRange || null,
        source_slice_object_key: sourceSliceObjectKey || null,
        preprocess_with_ocr: preprocessWithOcr === true,
      }),
    }),

  getMe: () => fetchApi<UserMeResponse>(`/api/user/me`),
  uploadAvatar: async (file: File): Promise<{ avatar_url: string }> => {
    const path = "/api/user/avatar";
    const url = `${API_BASE}${path}`;
    const headers: Record<string, string> = {};
    if (typeof window !== "undefined") {
      try {
        const fp = await getFingerprint();
        if (fp) headers["X-Client-Fingerprint"] = fp;
      } catch {}
      const token = await getSessionToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(url, { method: "POST", credentials: "include", headers, body: fd });
    if (!res.ok) {
      if (res.status === 401) clearSessionTokenCache();
      const err = await res.json().catch(() => ({}));
      throw new Error((err.detail as string) || "Upload failed");
    }
    return res.json();
  },

  listTasks: () => fetchApi<TaskSummary[]>(`/api/tasks`),

  getTask: (taskId: string) =>
    fetchApi<TaskDetail>(`/api/tasks/${taskId}`),

  getTaskView: (taskId: string) =>
    fetchApi<TaskView>(`/api/tasks/${taskId}/view`),

  cancelTask: (taskId: string) =>
    fetchApi<{ ok: boolean; status: string }>(`/api/tasks/${taskId}/cancel`, {
      method: "POST",
    }),

  deleteTask: (taskId: string) =>
    fetchApi<void>(`/api/tasks/${taskId}`, { method: "DELETE" }),

  completePresignedUpload: (objectKey: string, filename: string, sizeBytes: number) =>
    fetchApi<CompleteMultipartResponse>(`/api/upload/presigned/complete`, {
      method: "POST",
      body: JSON.stringify({
        object_key: objectKey,
        filename,
        size_bytes: sizeBytes,
      }),
    }),

  sendCode: (email: string) =>
    fetchApi<{ ok: boolean }>(`/api/auth/send-code`, {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  verifyRegister: (email: string, code: string, password: string, confirmPassword: string) =>
    fetchApi<{ id: string; email: string }>(`/api/auth/verify-register`, {
      method: "POST",
      body: JSON.stringify({
        email,
        code,
        password,
        confirm_password: confirmPassword,
      }),
    }),

  login: (email: string, password: string) =>
    fetchApi<{ access_token: string; token_type: string; user?: { id: string; email: string } }>(`/api/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
};
