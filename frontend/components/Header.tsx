"use client";

import { useTranslations } from "next-intl";
import { usePathname, Link } from "@/i18n/navigation";
import { useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { locales, type Locale } from "@/i18n/config";
import { UserMenu } from "./UserMenu";

export function Header() {
  const t = useTranslations("header");
  const tAuth = useTranslations("auth");
  const pathname = usePathname();
  const locale = useLocale();
  const sessionState = useSession();
  const session = sessionState?.data;
  const status = sessionState?.status ?? "loading";

  const switchLocale = (newLocale: Locale) => {
    if (newLocale === locale) return;
    if (typeof window === "undefined") return;
    const raw = pathname && pathname !== "" ? pathname : "/";
    const path = raw.startsWith("/") ? raw : `/${raw}`;
    const pathSuffix = path === "/" ? "" : path;
    const newPath = `/${newLocale}${pathSuffix}`;
    const href = window.location.origin + newPath + (window.location.search || "");
    window.location.assign(href);
  };

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200 bg-white/95 dark:border-zinc-800 dark:bg-zinc-950/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:supports-[backdrop-filter]:bg-zinc-950/80">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-4 sm:px-6">
        <h1 className="max-w-[120px] truncate text-lg font-semibold tracking-tight text-zinc-800 dark:text-zinc-200 sm:max-w-none">
          {t("title")}
        </h1>

        <div className="flex items-center gap-3 sm:gap-4">
          <div className="flex items-center rounded-full bg-zinc-100 dark:bg-zinc-800 p-1">
            {locales.map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => switchLocale(loc)}
                className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wide transition-colors ${
                  locale === loc
                    ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                    : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                {loc === "zh" ? "中" : loc.toUpperCase()}
              </button>
            ))}
          </div>

          {status !== "loading" && (
            <>
              {session?.user ? (
                <UserMenu />
              ) : (
                <div className="flex items-center gap-2">
                  <Link
                    href="/login"
                    className="inline-flex min-h-[44px] items-center text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    {tAuth("signIn")}
                  </Link>
                  <Link
                    href="/register"
                    className="inline-flex min-h-[44px] items-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    {tAuth("getStarted")}
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}
