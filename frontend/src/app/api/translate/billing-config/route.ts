import {
  getTranslateCreditsPerPage,
  isTranslateCreditsEnabled,
} from '@/shared/lib/translate-billing';

/** 供翻译页客户端判断是否需要登录/积分预检（不含敏感信息） */
export async function GET() {
  return Response.json({
    credits_enabled: isTranslateCreditsEnabled(),
    credits_per_page: getTranslateCreditsPerPage(),
  });
}
