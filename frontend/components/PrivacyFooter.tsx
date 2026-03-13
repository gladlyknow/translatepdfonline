"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export function PrivacyFooter() {
  const t = useTranslations("footer");
  return (
    <footer className="shrink-0 border-t border-zinc-200 bg-white py-3 text-center text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
      <Link href="/privacy" className="hover:underline">
        {t("privacyPolicy")}
      </Link>
    </footer>
  );
}
