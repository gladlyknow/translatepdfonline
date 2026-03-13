"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id?: string;
  label?: string;
  error?: string;
  autoComplete?: string;
  minLength?: number;
  className?: string;
};

export function PasswordInput({
  value,
  onChange,
  placeholder,
  id,
  label,
  error,
  autoComplete,
  minLength,
  className = "",
}: Props) {
  const t = useTranslations("register");
  const [show, setShow] = useState(false);
  const inputId = id ?? "password-input";
  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-400">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={inputId}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          minLength={minLength}
          className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-3 pr-10 text-base dark:border-zinc-600 dark:bg-zinc-800"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2 top-1/2 min-h-[44px] min-w-[44px] -translate-y-1/2 rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700"
          aria-label={show ? t("hidePassword") : t("showPassword")}
          tabIndex={-1}
        >
          {show ? t("hidePassword") : t("showPassword")}
        </button>
      </div>
      {error && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
