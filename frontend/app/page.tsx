import { redirect } from "next/navigation";
import { defaultLocale } from "@/i18n/config";

/**
 * 根路径重定向到默认语言。
 * - 开发时若未启用 output: export，middleware 会先处理 /，此页作为兜底。
 * - 静态导出时无 middleware，访问 / 时由此重定向到 /zh。
 */
export default function RootPage() {
  redirect(`/${defaultLocale}`);
}
