"use client";

import { useTranslations } from "next-intl";
import type { UILang } from "@/lib/api";

const LANGS: { value: UILang; labelKey: string }[] = [
  { value: "zh", labelKey: "zh" },
  { value: "en", labelKey: "en" },
  { value: "es", labelKey: "es" },
];

type Props = {
  value: UILang | "";
  onChange: (v: UILang | "") => void;
  label?: string;
  placeholderKey?: "selectSourceLang" | "selectTargetLang";
};

export function LanguageSelector({ value, onChange, label, placeholderKey }: Props) {
  const tLang = useTranslations("languages");
  const tTranslate = useTranslations("translate");
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          {label}
        </label>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as UILang | "")}
        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
      >
        <option value="">
          {placeholderKey ? tTranslate(placeholderKey) : ""}
        </option>
        {LANGS.map(({ value: v, labelKey }) => (
          <option key={v} value={v}>
            {tLang(labelKey)}
          </option>
        ))}
      </select>
    </div>
  );
}
