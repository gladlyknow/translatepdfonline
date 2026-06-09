"use client";

import { useTranslations } from "next-intl";

export default function PrivacyPage() {
  const t = useTranslations("privacy");

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 text-sm leading-7 text-zinc-700 dark:text-zinc-300">
      <h1 className="mb-6 text-2xl font-semibold">{t("title")}</h1>
      <p className="mb-4">{t("intro")}</p>
      <h2 className="mt-6 mb-2 text-lg font-semibold">{t("section1Title")}</h2>
      <p className="mb-2">{t("section1Content")}</p>
      <h2 className="mt-6 mb-2 text-lg font-semibold">{t("section2Title")}</h2>
      <p className="mb-2">{t("section2Content")}</p>
      <h2 className="mt-6 mb-2 text-lg font-semibold">{t("section3Title")}</h2>
      <p className="mb-2">{t("section3Content")}</p>
      <h2 className="mt-6 mb-2 text-lg font-semibold">{t("section4Title")}</h2>
      <p className="mb-2">{t("section4Content")}</p>
      <h2 className="mt-6 mb-2 text-lg font-semibold">{t("section5Title")}</h2>
      <p className="mb-2">{t("section5Content")}</p>
      <h2 className="mt-6 mb-2 text-lg font-semibold">{t("section6Title")}</h2>
      <p>
        {t("section6Content")}{" "}
        <a
          href="mailto:support@translatepdfonline.com"
          className="text-blue-600 hover:underline dark:text-blue-400"
        >
          support@translatepdfonline.com
        </a>
        {t("section6Suffix")}
      </p>
    </main>
  );
}
