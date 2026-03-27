import { cookies } from 'next/headers';
import { nanoid } from 'nanoid';
import { getUserInfo } from '@/shared/models/user';

const ANON_COOKIE = 'translate_anon_id';
const ANON_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export async function getTranslateAuth(): Promise<{
  userId: string | null;
  anonId: string;
}> {
  const user = await getUserInfo();
  if (user?.id) {
    return { userId: user.id, anonId: '' };
  }
  const cookieStore = await cookies();
  let anonId = cookieStore.get(ANON_COOKIE)?.value;
  if (!anonId) {
    anonId = nanoid(32);
    cookieStore.set(ANON_COOKIE, anonId, {
      path: '/',
      maxAge: ANON_MAX_AGE,
      httpOnly: true,
      sameSite: 'lax',
    });
  }
  return { userId: null, anonId };
}
