import packageJson from '../../package.json';

// Note: Environment variables are loaded via dotenv-cli in package.json scripts.
// Next.js automatically loads .env files in the runtime, so no manual loading is needed here.

/** Hyperdrive 代理串仅在 Worker / wrangler 内可解析；`*.hyperdrive.local` 为本地模拟。 */
function isHyperdriveProxyDatabaseUrl(url: string | undefined): boolean {
  if (!url?.trim()) return false;
  const m = url
    .trim()
    .match(/^postgres(ql)?:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?/i);
  const h = (m?.[2] ?? '').toLowerCase();
  return (
    h.includes('hyperdrive.cloudflare.com') ||
    h.endsWith('.hyperdrive.local') ||
    h === 'hyperdrive.local'
  );
}

/**
 * `envConfigs.database_url`: 在 **next build** 时剥离 Hyperdrive 代理 URL，避免 Node 去 DNS `*.hyperdrive.cloudflare.com` / `*.hyperdrive.local`。
 * OpenNext 在生产 Worker 上常常 **没有** `globalThis.Cloudflare`；若仍按「非 Worker 就清空」会把 `database_url` 置空。
 * Worker 运行时以 `process.env.DATABASE_URL`（控制台 Secret）为主（见 `getPostgresDb()`）。此处仅在 `next build` 剥离 Hyperdrive 代理串，避免 Node DNS 失败。
 */
function effectiveDatabaseUrlFromEnv(): string {
  const raw = process.env.DATABASE_URL?.trim() ?? '';
  if (!raw) return '';
  if (!isHyperdriveProxyDatabaseUrl(raw)) return raw;

  const isBuild =
    process.env.npm_lifecycle_event === 'build' ||
    process.env.NEXT_PHASE === 'phase-production-build';
  if (isBuild) {
    const g = globalThis as typeof globalThis & {
      __translatepdf_hyperdrive_build_strip_logged__?: boolean;
    };
    if (!g.__translatepdf_hyperdrive_build_strip_logged__) {
      g.__translatepdf_hyperdrive_build_strip_logged__ = true;
      console.log(
        '[db] DATABASE_URL is Hyperdrive proxy; stripped during `next build` (CI: use Supabase/Neon origin URL or unset). ' +
          'Worker runtime: use DATABASE_URL (direct) or optional HYPERDRIVE.'
      );
    }
    return '';
  }

  return raw;
}

export type ConfigMap = Record<string, string>;

/**
 * 为 `/favicon.svg` 等静态路径追加 `?v=`，减轻浏览器/CDN 强缓存导致线上仍显示旧图标。
 * 可设 `NEXT_PUBLIC_ASSET_VERSION`；否则用 package.json 的 version（发版即变）。
 */
export function cacheBustedPublicPath(path: string): string {
  if (!path?.trim()) return path;
  const trimmed = path.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const v =
    process.env.NEXT_PUBLIC_ASSET_VERSION?.trim() || packageJson.version;
  if (!v) return trimmed;
  const sep = trimmed.includes('?') ? '&' : '?';
  return `${trimmed}${sep}v=${encodeURIComponent(v)}`;
}

export const envConfigs: ConfigMap = {
  app_url: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  app_name: process.env.NEXT_PUBLIC_APP_NAME ?? 'Translate PDF Online',
  app_description: process.env.NEXT_PUBLIC_APP_DESCRIPTION ?? '',
  app_logo: process.env.NEXT_PUBLIC_APP_LOGO ?? '/brand/logo-t-pdf.jpeg',
  app_favicon: process.env.NEXT_PUBLIC_APP_FAVICON ?? '/favicon.svg',
  app_preview_image:
    process.env.NEXT_PUBLIC_APP_PREVIEW_IMAGE ?? '/brand/t-pdf-preview.jpeg',
  /** 与 `public/preview.png` 像素尺寸一致，供 OG/Twitter meta；若更换预览图请同步改此值或设对应 env */
  app_preview_image_width:
    process.env.NEXT_PUBLIC_APP_PREVIEW_IMAGE_WIDTH ?? '1181',
  app_preview_image_height:
    process.env.NEXT_PUBLIC_APP_PREVIEW_IMAGE_HEIGHT ?? '945',
  theme: process.env.NEXT_PUBLIC_THEME ?? 'default',
  appearance: process.env.NEXT_PUBLIC_APPEARANCE ?? 'system',
  locale: process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? 'en',
  // Hyperdrive proxy URLs only work inside Workers; strip them for Node SSG/build.
  database_url: effectiveDatabaseUrlFromEnv(),
  database_auth_token: process.env.DATABASE_AUTH_TOKEN ?? '',
  database_provider: process.env.DATABASE_PROVIDER ?? 'postgresql',
  db_schema_file: process.env.DB_SCHEMA_FILE ?? './src/config/db/schema.ts',
  // PostgreSQL schema name (e.g. 'web'). Default: 'public'
  db_schema: process.env.DB_SCHEMA ?? 'public',
  // Drizzle migrations journal table name (avoid conflicts across projects)
  db_migrations_table:
    process.env.DB_MIGRATIONS_TABLE ?? '__drizzle_migrations',
  // Drizzle migrations journal schema (default in drizzle-kit is 'drizzle')
  // We keep 'public' as template default for stability on fresh Supabase DBs.
  db_migrations_schema: process.env.DB_MIGRATIONS_SCHEMA ?? 'drizzle',
  // Output folder for drizzle-kit generated migrations
  db_migrations_out:
    process.env.DB_MIGRATIONS_OUT ?? './src/config/db/migrations',
  db_singleton_enabled: process.env.DB_SINGLETON_ENABLED || 'false',
  db_max_connections: process.env.DB_MAX_CONNECTIONS || '1',
  auth_url: process.env.AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || '',
  // Comma-separated extra origins (e.g. workers.dev preview URL) for Better Auth trustedOrigins
  auth_trusted_origins: process.env.AUTH_TRUSTED_ORIGINS ?? '',
  auth_secret: process.env.AUTH_SECRET ?? '', // openssl rand -base64 32
  version: packageJson.version,
  locale_detect_enabled:
    process.env.NEXT_PUBLIC_LOCALE_DETECT_ENABLED ?? 'false',
  /** Creem trial: credits granted on subscription.trialing (see payment notify) */
  trial_credits_amount: process.env.TRIAL_CREDITS_AMOUNT ?? '50',
  /** Document with Creem product trial length; expiry uses webhook period end */
  trial_credits_days: process.env.TRIAL_CREDITS_DAYS ?? '3',
};
