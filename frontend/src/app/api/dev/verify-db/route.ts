/**
 * 开发/运维：在 Workers 环境验证 PG 连接、指定用户是否为管理员、config 表条数。
 * 仅当 query.secret 与 VERIFY_DB_SECRET 一致时返回数据，否则 401。
 *
 * 调用示例（在浏览器或 curl）：
 *   GET /api/dev/verify-db?secret=你的VERIFY_DB_SECRET
 *   GET /api/dev/verify-db?secret=xxx&email=gladlyknow@gmail.com
 *
 * ---
 * 为何测试环境配置 dump 到生产后“丢失”？
 * - 配置来自 DB 的 config 表 + 环境变量合并（env 覆盖 DB）。生产若设置了同名 env，会覆盖 DB。
 * - 若生产 DB 使用不同 schema（DB_SCHEMA），config 表可能在不同 schema，需确认 dump 包含该 schema。
 * - getConfigs 使用 Next 的 unstable_cache；Workers 上缓存可能与 Node 不同，可先看本接口返回的 configCount 是否 > 0。
 *
 * ---
 * 如何开启/指定管理用户？
 * 1) 先初始化 RBAC 角色与权限（若未做过）：
 *    npx tsx scripts/init-rbac.ts
 *    可选：npx tsx scripts/init-rbac.ts --admin-email=gladlyknow@gmail.com 直接赋予 super_admin
 * 2) 给已有用户赋管理员角色：
 *    npx tsx scripts/assign-role.ts --email=gladlyknow@gmail.com --role=admin
 *    需在能连上生产 DB 的环境执行（本地设 DATABASE_URL 为生产连接串再运行）。
 */
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/core/db';
import { config, role, user, userRole } from '@/config/db/schema';
import { isCloudflareWorker } from '@/shared/lib/env';

function getVerifyDbSecret(): string {
  if (isCloudflareWorker) {
    try {
      const ctx = getCloudflareContext();
      const env = (ctx as unknown as { env?: Record<string, unknown> })?.env;
      return String(env?.VERIFY_DB_SECRET ?? '');
    } catch {
      return '';
    }
  }
  return process.env.VERIFY_DB_SECRET || '';
}

export async function GET(request: Request) {
  const requiredSecret = getVerifyDbSecret();
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret') ?? '';
  const email = searchParams.get('email') ?? '';

  if (!requiredSecret || secret !== requiredSecret) {
    return NextResponse.json(
      { error: 'Unauthorized', hint: 'Set VERIFY_DB_SECRET and pass ?secret=...' },
      { status: 401 }
    );
  }

  const out: {
    db: string;
    configCount?: number;
    user?: { id: string; email: string; name: string };
    roles?: string[];
    isAdmin?: boolean;
    error?: string;
  } = { db: 'unknown' };

  try {
    // 1) 验证 PG 连接
    const ping = await db().execute(sql`SELECT 1 as ok`);
    out.db = Array.isArray(ping) && ping[0]?.ok === 1 ? 'ok' : 'fail';

    // 2) config 表条数（排查“配置丢失”时可看是否为空）
    const configRows = await db().select().from(config);
    out.configCount = configRows.length;

    // 3) 若传了 email，查该用户及其角色，并判断是否管理员
    if (email) {
      const [u] = await db()
        .select()
        .from(user)
        .where(eq(user.email, email));

      if (!u) {
        out.user = undefined;
        out.roles = [];
        out.isAdmin = false;
      } else {
        out.user = { id: u.id, email: u.email, name: u.name };

        const ur = await db()
          .select({ roleName: role.name })
          .from(userRole)
          .innerJoin(role, eq(userRole.roleId, role.id))
          .where(
            eq(userRole.userId, u.id)
          );

        const roleNames = ur.map((r: { roleName: string }) => r.roleName);
        out.roles = roleNames;
        out.isAdmin =
          roleNames.includes('admin') || roleNames.includes('super_admin');
      }
    }

    return NextResponse.json(out);
  } catch (e: any) {
    out.error = e?.message || String(e);
    out.db = 'error';
    return NextResponse.json(out, { status: 500 });
  }
}
