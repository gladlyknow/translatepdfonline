"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { signIn } from "next-auth/react";
import { useRouter } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { Header } from "@/components/Header";
import { PasswordInput } from "@/components/PasswordInput";
import { api } from "@/lib/api";
import { clearSessionTokenCache } from "@/lib/api";
import { validatePassword } from "@/lib/passwordValidation";

const CODE_COOLDOWN_SECONDS = 60;

export default function RegisterPage() {
  const t = useTranslations("register");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);

  const handleSendCode = useCallback(async () => {
    if (!email.trim()) {
      setError("Please enter your email");
      return;
    }
    setSendingCode(true);
    setError(null);
    try {
      await api.sendCode(email.trim());
      setCooldown(CODE_COOLDOWN_SECONDS);
      const id = setInterval(() => {
        setCooldown((c) => {
          if (c <= 1) {
            clearInterval(id);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send code");
    } finally {
      setSendingCode(false);
    }
  }, [email]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      const pwValidation = validatePassword(password);
      if (!pwValidation.valid) {
        setError(t(pwValidation.message));
        return;
      }
      if (password !== confirmPassword) {
        setError(t("passwordsMismatch"));
        return;
      }
      setSubmitting(true);
      try {
        await api.verifyRegister(email.trim(), code.trim(), password, confirmPassword);
        const signInResult = await signIn("credentials", {
          email: email.trim(),
          password,
          redirect: false,
        });
        if (signInResult?.ok) {
          clearSessionTokenCache();
          router.push("/");
          return;
        }
        setSuccess(true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Registration failed";
        setError(msg);
      } finally {
        setSubmitting(false);
      }
    },
    [email, code, password, confirmPassword, t, router]
  );

  if (success) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <Header />
        <main className="mx-auto max-w-md px-4 py-12">
          <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="mb-4 text-green-600 dark:text-green-400">{t("successFallback")}</p>
            <Link
              href="/"
              className="inline-block min-h-[44px] min-w-[44px] rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {t("backToHome")}
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <Header />
      <main className="mx-auto max-w-md px-4 py-12">
        <h1 className="mb-6 text-xl font-semibold">{t("title")}</h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <label htmlFor="register-email" className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-400">
              {t("email")}
            </label>
            <input
              id="register-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              autoComplete="email"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-600 dark:bg-zinc-800"
            />
          </div>
          <div className="flex gap-2">
            <input
              id="register-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t("code")}
              maxLength={10}
              className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-600 dark:bg-zinc-800"
            />
            <button
              type="button"
              onClick={handleSendCode}
              disabled={sendingCode || cooldown > 0}
              className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800"
            >
              {cooldown > 0 ? `${cooldown}s` : t("getCode")}
            </button>
          </div>
          <PasswordInput
            id="register-password"
            label={t("password")}
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            minLength={8}
            error={undefined}
          />
          <PasswordInput
            id="register-confirm"
            label={t("confirmPassword")}
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            minLength={8}
            error={undefined}
          />
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="min-h-[44px] rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "..." : t("submit")}
          </button>
        </form>
      </main>
    </div>
  );
}
