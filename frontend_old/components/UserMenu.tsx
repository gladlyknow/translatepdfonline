"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import { signOut, useSession } from "next-auth/react";
import { useStaticAuth } from "./StaticAuthContext";

export function UserMenu() {
  const tAuth = useTranslations("auth");
  const locale = useLocale();
  const sessionState = useSession();
  const session = sessionState?.data;
  const staticAuth = useStaticAuth();
  const isStaticDeploy = process.env.NEXT_PUBLIC_STATIC_DEPLOY === "1";
  const [open, setOpen] = useState(false);

  const label = useMemo(() => {
    if (isStaticDeploy && staticAuth?.user)
      return staticAuth.user.display_name || staticAuth.user.email || "User";
    const u = session?.user;
    return u?.name || u?.email || "User";
  }, [isStaticDeploy, staticAuth?.user, session?.user]);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  const doSignOut = useCallback(async () => {
    close();
    if (isStaticDeploy && staticAuth) {
      staticAuth.setToken(null);
      window.location.href = `/${locale}`;
      return;
    }
    await signOut({ callbackUrl: "/" });
  }, [close, isStaticDeploy, staticAuth, locale]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
      >
        <span className="max-w-[180px] truncate">{label}</span>
        <span className="text-zinc-400 dark:text-zinc-500">▾</span>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={close}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
          >
            <button
              type="button"
              role="menuitem"
              onClick={doSignOut}
              className="w-full px-4 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              {tAuth("signOut")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

