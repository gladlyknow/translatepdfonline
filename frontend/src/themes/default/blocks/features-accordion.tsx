'use client';

import { useState } from 'react';

import { LazyImage, SmartIcon } from '@/shared/blocks/common';
import { BorderBeam } from '@/shared/components/magicui/border-beam';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/shared/components/ui/accordion';
import { ScrollAnimation } from '@/shared/components/ui/scroll-animation';
import { cn } from '@/shared/lib/utils';
import { Section } from '@/shared/types/blocks/landing';

export function FeaturesAccordion({
  section,
  className,
}: {
  section: Section;
  className?: string;
}) {
  const [activeItem, setActiveItem] = useState<string>('item-1');

  return (
    // overflow-x-hidden to prevent horizontal scroll
    <section
      className={cn(
        'overflow-x-hidden py-16 md:py-24',
        section.className,
        className
      )}
    >
      {/* add overflow-x-hidden to container */}
      <div className="container space-y-8 overflow-x-hidden px-2 sm:px-6 md:space-y-16 lg:space-y-20 dark:[--color-border:color-mix(in_oklab,var(--color-white)_10%,transparent)]">
        <ScrollAnimation>
          <div className="mx-auto max-w-4xl text-center text-balance">
            <h2 className="text-foreground mb-4 text-3xl font-semibold tracking-tight md:text-4xl">
              {section.title}
            </h2>
            <p className="text-muted-foreground mb-6 md:mb-12 lg:mb-16">
              {section.description}
            </p>
          </div>
        </ScrollAnimation>

        {/* grid: clamp min-w-0 and fix px padding/breakpoints */}
        <div className="grid min-w-0 gap-12 sm:px-6 md:grid-cols-2 lg:gap-20 lg:px-0">
          <ScrollAnimation delay={0.1} direction="left">
            <Accordion
              type="single"
              value={activeItem}
              onValueChange={(value) => setActiveItem(value as string)}
              className="w-full"
            >
              {section.items?.map((item, idx) => (
                <AccordionItem value={`item-${idx + 1}`} key={idx}>
                  <AccordionTrigger>
                    <div className="flex items-center gap-2 text-base">
                      {item.icon && (
                        <SmartIcon name={item.icon as string} size={24} />
                      )}
                      {item.title}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>{item.description}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </ScrollAnimation>

          <ScrollAnimation delay={0.2} direction="right">
            {/* 固定高度 + contain：整图等比可见、不裁切；已去掉斜纹装饰以免压在图上 */}
            <div className="bg-background relative min-w-0 overflow-hidden rounded-3xl border p-2">
              <div
                className={cn(
                  'bg-background relative w-full min-w-0 overflow-hidden rounded-2xl border bg-muted/20 shadow-md',
                  'h-[min(52vw,13.5rem)] sm:h-[15rem] md:h-[17rem]'
                )}
              >
                {/* 所有图片堆叠绝对定位，按 activeItem 切换 opacity 实现 CSS 交叉淡入，零动画库。 */}
                {section.items?.map((item, idx) => {
                  const itemKey = `item-${idx + 1}`;
                  const isActive = itemKey === activeItem;
                  return (
                    <div
                      key={itemKey}
                      className={cn(
                        'absolute inset-0 min-h-0 overflow-hidden rounded-[inherit] transition-opacity duration-200 ease-out',
                        isActive ? 'opacity-100' : 'opacity-0'
                      )}
                      aria-hidden={!isActive}
                    >
                      <LazyImage
                        src={item.image?.src ?? ''}
                        alt={item.image?.alt || item.title || ''}
                        className="h-full w-full object-contain object-center dark:mix-blend-lighten"
                        responsive
                      />
                    </div>
                  );
                })}
              </div>
              <BorderBeam
                duration={6}
                size={200}
                className="from-transparent via-yellow-700 to-transparent dark:via-white/50"
              />
            </div>
          </ScrollAnimation>
        </div>
      </div>
    </section>
  );
}
