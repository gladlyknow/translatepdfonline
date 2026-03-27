import { nanoid } from 'nanoid';
import { getTranslateAuth } from '../../translate/auth';
import { createPresignedPut, isR2Configured } from '@/shared/lib/translate-r2';
import {
  ALLOWED_CONTENT_TYPE,
  MAX_PDF_BYTES,
  UPLOAD_KEY_PREFIX,
  UPLOAD_KEY_SUFFIX,
} from '../constants';

export async function POST(req: Request) {
  try {
    const { userId } = await getTranslateAuth();
    if (!userId) {
      return Response.json(
        { detail: 'Login required to upload' },
        { status: 401 }
      );
    }
    if (!(await isR2Configured())) {
      return Response.json(
        { detail: 'Upload storage not configured' },
        { status: 503 }
      );
    }
    const body = await req.json();
    const sizeBytes = Number(body.size_bytes) || 0;
    if (sizeBytes <= 0 || sizeBytes > MAX_PDF_BYTES) {
      return Response.json(
        { detail: 'Invalid size: must be between 1 and 100 MB' },
        { status: 400 }
      );
    }
    const contentType =
      typeof body.content_type === 'string' ? body.content_type.trim() : '';
    if (contentType !== ALLOWED_CONTENT_TYPE) {
      return Response.json(
        { detail: 'Only application/pdf is allowed' },
        { status: 400 }
      );
    }
    const objectKey = `${UPLOAD_KEY_PREFIX}${nanoid(16)}${UPLOAD_KEY_SUFFIX}`;
    const uploadUrl = await createPresignedPut(
      objectKey,
      ALLOWED_CONTENT_TYPE,
      600
    );
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    return Response.json({
      upload_url: uploadUrl,
      object_key: objectKey,
      expires_at: expiresAt,
    });
  } catch (e) {
    console.error('create presigned upload failed:', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
