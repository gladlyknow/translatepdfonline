/**
 * Translate/PDF API client for Route A (same-origin Next API).
 * All paths are relative; use credentials: include for session.
 */

export type UILang =
  | 'zh'
  | 'en'
  | 'es'
  | 'fr'
  | 'it'
  | 'el'
  | 'ja'
  | 'ko'
  | 'de'
  | 'ru';

export interface DocumentSummary {
  id: string;
  filename: string;
  size_bytes: number;
  status: string;
  created_at: string;
}

export interface DocumentDetail {
  id: string;
  filename: string;
  size_bytes: number;
  status: string;
  created_at: string;
  expires_at?: string | null;
  /** 数据库已知总页数（预览未就绪时仍可用于积分预估） */
  page_count?: number | null;
}

export interface DocumentPreviewUrlResponse {
  preview_url: string;
  /** 0 表示服务端未解析（大文件 Worker 不整本加载），由前端 pdf.js 得到页数 */
  total_pages: number;
}

export interface TaskSummary {
  id: string;
  document_id: string;
  status: string;
  source_lang: string;
  target_lang: string;
  preprocess_with_ocr?: boolean;
  created_at: string;
  document_filename?: string | null;
  page_range?: string | null;
  /** 用户提交的页范围；仅当与有效 page_range 不一致时存在 */
  page_range_user_input?: string | null;
  document_page_count?: number | null;
  updated_at?: string | null;
}

export interface TaskDetail {
  id: string;
  document_id: string;
  source_lang: string;
  target_lang: string;
  page_range: string | null;
  page_range_user_input?: string | null;
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
  page_range_effective?: string | null;
  page_range_adjusted?: boolean;
  page_range_user_input?: string | null;
  document_page_count?: number | null;
}

/** 创建任务回调：与 {@link TranslateResponse} 对齐的可选字段 */
export type TranslateTaskCreatedMeta = Pick<
  TranslateResponse,
  | 'page_range_effective'
  | 'page_range_adjusted'
  | 'page_range_user_input'
  | 'document_page_count'
>;

export interface TranslateBillingConfigResponse {
  credits_enabled: boolean;
  credits_per_page: number;
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

export interface TaskView {
  task: TaskDetail;
  document_filename: string;
  document_size_bytes?: number;
  outputs: TaskOutputFile[];
  primary_file_url?: string | null;
  source_pdf_url?: string | null;
  can_download?: boolean;
}

async function fetchTranslateApi<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = path.startsWith('/') ? path : `/${path}`;
  const headers: Record<string, string> = {
    ...((options?.headers as Record<string, string>) ?? {}),
  };
  const body = options?.body;
  if (
    options?.method !== 'GET' &&
    body !== undefined &&
    typeof body === 'string'
  ) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = (err as { detail?: string })?.detail ?? res.statusText;
    const error = new Error(detail) as Error & {
      status?: number;
      body?: Record<string, unknown>;
    };
    error.status = res.status;
    if (err && typeof err === 'object') {
      error.body = err as Record<string, unknown>;
    }
    throw error;
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const translateApi = {
  listDocuments: () =>
    fetchTranslateApi<DocumentSummary[]>('/api/documents'),

  getDocument: (documentId: string) =>
    fetchTranslateApi<DocumentDetail>(`/api/documents/${documentId}`),

  getDocumentPreviewUrl: (documentId: string, page = 1) =>
    fetchTranslateApi<DocumentPreviewUrlResponse>(
      `/api/documents/${documentId}/preview-url?page=${encodeURIComponent(String(page))}`
    ),

  deleteDocument: (documentId: string) =>
    fetchTranslateApi<void>(`/api/documents/${documentId}`, {
      method: 'DELETE',
    }),

  createPresignedUpload: (filename: string, sizeBytes: number) =>
    fetchTranslateApi<PresignedUploadResponse>('/api/upload/presigned', {
      method: 'POST',
      body: JSON.stringify({
        filename,
        size_bytes: sizeBytes,
        content_type: 'application/pdf',
      }),
    }),

  completePresignedUpload: (
    objectKey: string,
    filename: string,
    sizeBytes: number
  ) =>
    fetchTranslateApi<CompleteMultipartResponse>('/api/upload/presigned/complete', {
      method: 'POST',
      body: JSON.stringify({
        object_key: objectKey,
        filename,
        size_bytes: sizeBytes,
      }),
    }),

  getPresignedSlice: (documentId: string, pageRange: string) =>
    fetchTranslateApi<{
      upload_url: string;
      slice_object_key: string;
      expires_at: string;
    }>('/api/upload/presigned-slice', {
      method: 'POST',
      body: JSON.stringify({
        document_id: documentId,
        page_range: pageRange,
      }),
    }),

  getBillingConfig: () =>
    fetchTranslateApi<TranslateBillingConfigResponse>(
      '/api/translate/billing-config'
    ),

  translate: (
    documentId: string,
    sourceLang: UILang,
    targetLang: UILang,
    pageRange?: string,
    sourceSliceObjectKey?: string,
    preprocessWithOcr?: boolean
  ) =>
    fetchTranslateApi<TranslateResponse>('/api/translate', {
      method: 'POST',
      body: JSON.stringify({
        document_id: documentId,
        source_lang: sourceLang,
        target_lang: targetLang,
        page_range: pageRange ?? null,
        source_slice_object_key: sourceSliceObjectKey ?? null,
        preprocess_with_ocr: preprocessWithOcr === true,
      }),
    }),

  createOcrTask: (
    documentId: string,
    sourceLang: UILang,
    targetLang: UILang
  ) =>
    fetchTranslateApi<{ task_id: string }>('/api/ocr/tasks', {
      method: 'POST',
      body: JSON.stringify({
        document_id: documentId,
        source_lang: sourceLang,
        target_lang: targetLang,
      }),
    }),

  listTasks: () => fetchTranslateApi<TaskSummary[]>('/api/tasks'),

  getTask: (taskId: string) =>
    fetchTranslateApi<TaskDetail>(`/api/tasks/${taskId}`),

  getTaskView: (taskId: string) =>
    fetchTranslateApi<TaskView>(`/api/tasks/${taskId}/view`),

  getTaskOutputPreviewUrl: (taskId: string, page = 1) =>
    fetchTranslateApi<DocumentPreviewUrlResponse>(
      `/api/tasks/${taskId}/output-preview-url?page=${encodeURIComponent(String(page))}`
    ),

  cancelTask: (taskId: string) =>
    fetchTranslateApi<{ ok: boolean; status: string }>(
      `/api/tasks/${taskId}/cancel`,
      { method: 'POST' }
    ),

  deleteTask: (taskId: string) =>
    fetchTranslateApi<void>(`/api/tasks/${taskId}`, { method: 'DELETE' }),
};
