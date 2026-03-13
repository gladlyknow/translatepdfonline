import { defineRouting } from "next-intl/routing";
import { locales, defaultLocale } from "./config";

export const routing = defineRouting({
  locales,
  defaultLocale,
  // 使用 always，避免“登录/注册”链接变成 /login、/register 后被按浏览器语言重定向到 /zh/login
  localePrefix: "always",
});
