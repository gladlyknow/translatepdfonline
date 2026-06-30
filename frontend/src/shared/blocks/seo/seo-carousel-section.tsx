'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from '@/shared/components/ui/carousel';
import { cn } from '@/shared/lib/utils';

type Props = {
  title: string;
  items: ReactNode[];
  variant?: 'card' | 'section';
  className?: string;
};

const AUTOPLAY_MS = 5000;

export function SeoCarouselSection({ title, items, variant = 'card', className }: Props) {
  const [api, setApi] = useState<CarouselApi | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!api) return;
    stop();
    intervalRef.current = setInterval(() => {
      if (api.canScrollNext()) {
        api.scrollNext();
      } else {
        api.scrollTo(0);
      }
    }, AUTOPLAY_MS);
    return stop;
  }, [api, stop]);

  if (!items.length) return null;

  return (
    <section className={cn('mx-auto w-full max-w-5xl', className)}>
      <h2 className="text-2xl font-bold text-center mb-8 text-foreground">{title}</h2>
      <Carousel opts={{ align: 'start', loop: false }} setApi={setApi}>
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
