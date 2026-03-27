import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { oneTap } from 'better-auth/plugins';
import { getLocale } from 'next-intl/server';

import { db } from '@/core/db';
import {
  getHyperdriveConnectionString,
  hasPostgresRuntimeConfig,
} from '@/core/db/postgres';
import { envConfigs } from '@/config';
import * as schema from '@/config/db/schema';
import { ResetPasswordEmail } from '@/shared/blocks/email/reset-password-email';
import { VerifyEmail } from '@/shared/blocks/email/verify-email';
import {
  getCookieFromCtx,
  getHeaderValue,
  guessLocaleFromAcceptLanguage,
} from '@/shared/lib/cookie';
import { getUuid } from '@/shared/lib/hash';
import { getClientIp } from '@/shared/lib/ip';
import { grantCreditsForNewUser } from '@/shared/models/credit';
import { getEmailService } from '@/shared/services/email';
import { grantRoleForNewUser } from '@/shared/services/rbac';

// Best-effort dedupe to prevent sending verification emails too frequently.
// This is especially helpful in dev/hot reload, transient network conditions,
// and to add a server-side throttle beyond any client-side cooldown.
const recentVerificationEmailSentAt = new Map<string, number>();
const recentResetPasswordEmailSentAt = new Map<string, number>();
const VERIFICATION_EMAIL_MIN_INTERVAL_MS = 60_000;
const RESET_PASSWORD_EMAIL_MIN_INTERVAL_MS = 60_000;

// Build trustedOrigins: app_url + optional AUTH_TRUSTED_ORIGINS (comma-separated)
function getTrustedOrigins(): string[] {
  const list: string[] = [];
  if (envConfigs.app_url) list.push(envConfigs.app_url);
  const extra = envConfigs.auth_trusted_origins
    ?.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  extra?.forEach((o) => {
    if (o && !list.includes(o)) list.push(o);
  });
  return list;
}

// Static auth options - NO database connection
// This ensures zero database calls during build time
const authOptions = {
  appName: envConfigs.app_name,
  baseURL: envConfigs.auth_url,
  secret: envConfigs.auth_secret,
  trustedOrigins: getTrustedOrigins(),
  user: {
    // Allow persisting custom columns on user table.
    // Without this, better-auth may ignore extra properties during create/update.
    additionalFields: {
      utmSource: {
        type: 'string',
        // Not user-editable input; we set it internally.
        input: false,
        required: false,
        defaultValue: '',
      },
      ip: {
        type: 'string',
        input: false,
        required: false,
        defaultValue: '',
      },
      locale: {
        type: 'string',
        input: false,
        required: false,
        defaultValue: '',
      },
    },
  },
  advanced: {
    database: {
      generateId: () => getUuid(),
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  logger: {
    verboseLogging: false,
    // Disable all logs during build and production
    disabled: true,
  },
};

// get auth options with configs
export async function getAuthOptions(configs: Record<string, string>) {
  const emailVerificationEnabled =
    configs.email_verification_enabled === 'true' && !!configs.resend_api_key;

  const useDb = hasPostgresRuntimeConfig();
  if (process.env.AUTH_DB_DIAG === '1' || process.env.AUTH_DB_DIAG === 'true') {
    console.warn(
      '[auth-db] getAuthOptions (src/core/auth/config.ts):',
      JSON.stringify({
        useDb,
        database_provider: envConfigs.database_provider,
        envConfigsHasDatabaseUrl: Boolean(envConfigs.database_url?.trim()),
        processEnvHasDatabaseUrl: Boolean(process.env.DATABASE_URL?.trim()),
        hasHyperdriveUrl: Boolean(getHyperdriveConnectionString()?.trim()),
      })
    );
  }

  return {
    ...authOptions,
    // Add database connection only when actually needed (runtime).
    // Workers: 有 HYPERDRIVE 绑定时使用 Hyperdrive 连接串；见 getPostgresDb。
    // Detection: src/core/db/postgres.ts → hasPostgresRuntimeConfig() / getHyperdriveConnectionString()
    database: useDb
      ? drizzleAdapter(db(), {
          provider: getDatabaseProvider(envConfigs.database_provider),
          schema: schema,
        })
      : null,
    databaseHooks: {
      user: {
        create: {
          before: async (user: any, ctx: any) => {
            try {
              const ip = await getClientIp();
              if (ip) {
                user.ip = ip;
              }

              // Prefer NEXT_LOCALE cookie (next-intl). Fallback to accept-language.
              const localeFromCookie = getCookieFromCtx(ctx, 'NEXT_LOCALE');

              const localeFromHeader = guessLocaleFromAcceptLanguage(
                getHeaderValue(ctx, 'accept-language')
              );

              const locale =
                (localeFromCookie || localeFromHeader || (await getLocale())) ??
                '';

              if (locale && typeof locale === 'string') {
                user.locale = locale.slice(0, 20);
              }

              // Only set on first creation; never overwrite later.
              if (user?.utmSource) return user;

              const raw = getCookieFromCtx(ctx, 'utm_source');
              if (!raw || typeof raw !== 'string') return user;

              // Keep it small & safe.
              const decoded = decodeURIComponent(raw).trim();
              const sanitized = decoded
                .replace(/[^\w\-.:]/g, '') // allow a-zA-Z0-9_ - . :
                .slice(0, 100);

              if (sanitized) {
                user.utmSource = sanitized;
              }
            } catch {
              // best-effort only
            }
            return user;
          },
          after: async (user: any) => {
            try {
              if (!user.id) {
                throw new Error('user id is required');
              }

              // grant credits for new user
              await grantCreditsForNewUser(user);

              // grant role for new user
              await grantRoleForNewUser(user);
            } catch (e) {
              console.log('grant credits or role for new user failed', e);
            }
          },
        },
      },
    },
    emailAndPassword: {
      enabled: configs.email_auth_enabled !== 'false',
      requireEmailVerification: emailVerificationEnabled,
      // Avoid creating a session immediately after sign up when verification is required.
      autoSignIn: emailVerificationEnabled ? false : true,
      sendResetPassword: async (
        { user, url }: { user: any; url: string; token: string },
        _request: Request
      ) => {
        try {
          // 未配置 Resend 时无法发邮件，仅打日志（前端仍显示“已发送”以防枚举邮箱）
          if (!configs.resend_api_key) {
            console.warn(
              '[auth] 重置密码邮件未发送：未配置 Resend（后台设置中填写 resend_api_key / 发件邮箱）'
            );
            return;
          }

          const key = String(user?.email || '').toLowerCase();
          const now = Date.now();
          const last =
            recentResetPasswordEmailSentAt.get(key) || 0;
          if (
            key &&
            now - last < RESET_PASSWORD_EMAIL_MIN_INTERVAL_MS
          ) {
            return;
          }
          if (key) {
            recentResetPasswordEmailSentAt.set(key, now);
          }

          const emailService = await getEmailService(configs as any);
          const logoUrl = envConfigs.app_logo?.startsWith('http')
            ? envConfigs.app_logo
            : `${envConfigs.app_url}${envConfigs.app_logo?.startsWith('/') ? '' : '/'}${envConfigs.app_logo || ''}`;
          await emailService.sendEmail({
            to: user.email,
            subject: `Reset your password - ${envConfigs.app_name}`,
            react: ResetPasswordEmail({
              appName: envConfigs.app_name,
              logoUrl,
              url,
            }),
          });
        } catch (e) {
          console.error('[auth] send reset password email failed:', e);
        }
      },
    },
    ...(emailVerificationEnabled
      ? {
          emailVerification: {
            // We explicitly send verification emails from the UI with a callbackURL
            // (redirecting to /verify-email). Disabling automatic sends avoids duplicates.
            sendOnSignUp: false,
            sendOnSignIn: false,
            // After user clicks the verification link, create session automatically.
            autoSignInAfterVerification: true,
            // 24 hours
            expiresIn: 60 * 60 * 24,
            sendVerificationEmail: async (
              { user, url }: { user: any; url: string; token: string },
              _request: Request
            ) => {
              try {
                const key = String(user?.email || '').toLowerCase();
                const now = Date.now();
                const last = recentVerificationEmailSentAt.get(key) || 0;
                if (key && now - last < VERIFICATION_EMAIL_MIN_INTERVAL_MS) {
                  return;
                }
                if (key) {
                  recentVerificationEmailSentAt.set(key, now);
                }

                const emailService = await getEmailService(configs as any);
                const logoUrl = envConfigs.app_logo?.startsWith('http')
                  ? envConfigs.app_logo
                  : `${envConfigs.app_url}${envConfigs.app_logo?.startsWith('/') ? '' : '/'}${envConfigs.app_logo || ''}`;
                // Avoid blocking auth response on email sending.
                await emailService.sendEmail({
                  to: user.email,
                  subject: `Verify your email - ${envConfigs.app_name}`,
                  react: VerifyEmail({
                    appName: envConfigs.app_name,
                    logoUrl,
                    url,
                  }),
                });
              } catch (e) {
                console.log('send verification email failed:', e);
              }
            },
          },
        }
      : {}),
    socialProviders: await getSocialProviders(configs),
    // One Tap 回调需校验/换票，与 Google OAuth 一致：必须同时配置 client id + secret（仅 id 会 500）
    plugins:
      configs.google_client_id &&
      configs.google_client_secret &&
      configs.google_one_tap_enabled === 'true'
        ? [oneTap()]
        : [],
  };
}

// get social providers with configs
export async function getSocialProviders(configs: Record<string, string>) {
  const providers: any = {};

  // google auth
  if (configs.google_client_id && configs.google_client_secret) {
    providers.google = {
      clientId: configs.google_client_id,
      clientSecret: configs.google_client_secret,
    };
  }

  // github auth
  if (configs.github_client_id && configs.github_client_secret) {
    providers.github = {
      clientId: configs.github_client_id,
      clientSecret: configs.github_client_secret,
    };
  }

  return providers;
}

// convert database provider to better-auth database provider
export function getDatabaseProvider(
  provider: string
): 'sqlite' | 'pg' | 'mysql' {
  switch (provider) {
    case 'sqlite':
      return 'sqlite';
    case 'turso':
      return 'sqlite';
    case 'postgresql':
      return 'pg';
    case 'mysql':
      return 'mysql';
    default:
      throw new Error(
        `Unsupported database provider for auth: ${envConfigs.database_provider}`
      );
  }
}
