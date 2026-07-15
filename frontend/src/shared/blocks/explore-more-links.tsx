import Image from 'next/image';

import { Link } from '@/core/i18n/navigation';

export type ExploreLink = {
  href: string;
  icon: string;
  label: string;
  desc: string;
};

/**
 * 统一的「Explore more converters」跳转卡片网格。
 * 4 列等高卡片，避免内联卡因文案长短不一导致大小不一致。
 * 纯展示组件（无 'use client'），可在 server / client 复用。
 */
export function ExploreMoreLinks({
  heading,
  links,
}: {
  heading: string;
  links: ExploreLink[];
}) {
  return (
    <section className="mx-auto max-w-5xl px-4 border-t pt-8 pb-16">
      <h3 className="text-lg font-semibold text-center mb-6 text-foreground">
        {heading}
      </h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group flex h-full flex-col items-center gap-3 rounded-2xl border-2 border bg-card p-5 text-center transition-colors hover:border-sky-300/80 hover:bg-accent/40"
          >
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
              <Image
                src={`/brand/icons/${link.icon}`}
                alt=""
                width={28}
                height={28}
                className="size-7"
              />
            </div>
            <span className="text-sm font-semibold text-foreground">
              {link.label}
            </span>
            <span className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
              {link.desc}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
