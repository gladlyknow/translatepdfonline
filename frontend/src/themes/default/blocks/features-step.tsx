'use client';

import { ArrowBigRight } from 'lucide-react';

import { LazyImage, SmartIcon } from '@/shared/blocks/common';
import { ScrollAnimation } from '@/shared/components/ui/scroll-animation';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/shared/components/ui/carousel';
import { cn } from '@/shared/lib/utils';
import { Section } from '@/shared/types/blocks/landing';

export function FeaturesStep({
  section,
  className,
}: {
  section: Section;
  className?: string;
}) {
  const useCarousel = Boolean(section.carousel);
  const items = section.items ?? [];
  const stepGridClass =
    items.length > 4
      ? 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'
      : items.length === 3
        ? 'md:grid-cols-3'
        : 'md:grid-cols-2 @3xl:grid-cols-4';

  return (
    <section
      id={section.id}
      className={cn('py-16 md:py-24', section.className, className)}
    >
      <div className="m-4 rounded-[2rem]">
        <div className="@container relative container">
          <ScrollAnimation>
            <div className="mx-auto max-w-2xl text-center">
              <span className="text-primary">{section.label}</span>
              <h2 className="text-foreground mt-4 text-4xl font-semibold">
                {section.title}
              </h2>
              <p className="text-muted-foreground mt-4 text-lg text-balance">
                {section.description}
              </p>
            </div>
          </ScrollAnimation>

          {useCarousel ? (
            <ScrollAnimation delay={0.15}>
              <div className="relative mx-auto mt-14 max-w-5xl px-10 md:px-14">
                <Carousel
                  opts={{ loop: true, align: 'start' }}
                  className="w-full"
                >
                  <CarouselContent>
                    {items.map((item, idx) => (
                      <CarouselItem key={idx}>
                        <div className="border-border/80 bg-card/30 space-y-4 rounded-2xl border p-4 md:p-6">
                          <div className="flex items-center gap-3">
                            <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-medium">
                              {idx + 1}
                            </span>
                            <h3 className="text-foreground text-lg font-semibold">
                              {item.title}
                            </h3>
                          </div>
                          {item.image?.src ? (
                            <div className="bg-muted/50 flex min-h-[100px] items-center justify-center rounded-xl p-2 md:min-h-[120px] md:p-4">
                              <LazyImage
                                src={item.image.src}
                                alt={item.image.alt || item.title || 'Step'}
                                width={item.image.width ?? 960}
                                height={item.image.height ?? 600}
                                className="max-h-[min(52vh,460px)] w-auto max-w-full object-contain object-top"
                              />
                            </div>
                          ) : null}
                          <p className="text-muted-foreground text-sm text-pretty md:text-base">
                            {item.description}
                          </p>
                        </div>
                      </CarouselItem>
                    ))}
                  </CarouselContent>
                  <CarouselPrevious className="left-0 md:left-1" />
                  <CarouselNext className="right-0 md:right-1" />
                </Carousel>
              </div>
            </ScrollAnimation>
          ) : null}

          <ScrollAnimation delay={useCarousel ? 0.25 : 0.2}>
            <div className={cn('mt-20 grid gap-8 sm:gap-10', stepGridClass)}>
              {items.map((item, idx) => (
                <div className="space-y-6" key={idx}>
                  <div className="text-center">
                    <span className="mx-auto flex size-6 items-center justify-center rounded-full bg-zinc-500/15 text-sm font-medium">
                      {idx + 1}
                    </span>
                    <div className="relative">
                      <div className="mx-auto my-6 w-fit">
                        {item.icon && (
                          <SmartIcon name={item.icon as string} size={24} />
                        )}
                      </div>
                      {idx < items.length - 1 && items.length <= 4 && (
                        <ArrowBigRight className="fill-muted stroke-primary absolute inset-y-0 right-0 my-auto mt-1 hidden translate-x-[150%] drop-shadow @3xl:block" />
                      )}
                    </div>
                    <h3 className="text-foreground mb-4 text-lg font-semibold">
                      {item.title}
                    </h3>
                    <p className="text-muted-foreground text-balance">
                      {item.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollAnimation>
        </div>
      </div>
    </section>
  );
}
