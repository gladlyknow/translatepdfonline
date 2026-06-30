'use client';

import type { ReactNode } from 'react';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/shared/components/ui/carousel';
import { cn } from '@/shared/lib/utils';

type Props = {
  title: string;
  items: ReactNode[];
  /** card = slides look like cards; section = full-width text slides (for long-form SEO content) */
  variant?: 'card' | 'section';
  className?: string;
};

export function SeoCarouselSection({ title, items, variant = 'card', className }: Props) {
  if (!items.length) return null;

  return (
    <section className={cn('mx-auto w-full max-w-5xl', className)}>
      <h2 className="text-2xl font-bold text-center mb-8 text-foreground">{title}</h2>
      <Carousel opts={{ align: 'start', loop: false }}>
        <CarouselContent>
          {items.map((item, i) => (
            <CarouselItem key={i} className="basis-full">
              {variant === 'card' ? (
                <div className="rounded-2xl border-2 border bg-card p-6 h-full text-center">
                  {item}
                </div>
              ) : (
                <div className="rounded-2xl border border-border bg-card p-6 h-full text-sm text-muted-foreground leading-relaxed">
                  {item}
                </div>
              )}
            </CarouselItem>
          ))}
        </CarouselContent>
        <div className="flex justify-center gap-2 mt-4">
          <CarouselPrevious className="static translate-y-0 size-8" />
          <CarouselNext className="static translate-y-0 size-8" />
        </div>
      </Carousel>
    </section>
  );
}
