'use client';

import { Link } from '@/core/i18n/navigation';
import {
  TRANSLATE_PRIMARY_CTA_CLASSNAME,
  TRANSLATE_SECONDARY_OUTLINE_CTA_CLASSNAME,
} from '@/config/translate-ui';
import { SmartIcon } from '@/shared/blocks/common/smart-icon';
import { Button } from '@/shared/components/ui/button';
import { ScrollAnimation } from '@/shared/components/ui/scroll-animation';
import { cn } from '@/shared/lib/utils';
import { Section } from '@/shared/types/blocks/landing';

function isTranslatePath(url: string) {
  const u = url.split('?')[0]?.replace(/\/$/, '') ?? '';
  return (
    u === '/translate' ||
    u.endsWith('/translate') ||
    u === '/upload' ||
    u.endsWith('/upload')
  );
}

export function Cta({
  section,
  className,
}: {
  section: Section;
  className?: string;
}) {
  return (
    <section
      id={section.id}
      className={cn('py-16 md:py-24', section.className, className)}
    >
      <div className="container">
        <div className="text-center">
          <ScrollAnimation>
            <h2 className="text-4xl font-semibold text-balance lg:text-5xl">
              {section.title}
            </h2>
          </ScrollAnimation>
          <ScrollAnimation delay={0.15}>
            <p
              className="mt-4"
              dangerouslySetInnerHTML={{ __html: section.description ?? '' }}
            />
          </ScrollAnimation>

          <ScrollAnimation delay={0.3}>
            <div className="mt-12 flex flex-wrap justify-center gap-4">
              {section.buttons?.map((button, idx) => {
                const href = button.url || '';
                const v = button.variant || 'default';
                const brandPrimary =
                  (v === 'default' || v === 'dark') && isTranslatePath(href);
                const brandOutline = v === 'outline';
                return (
                  <Button
                    asChild
                    size={button.size || 'default'}
                    variant={brandPrimary ? 'default' : v}
                    className={cn(
                      'px-4 text-sm',
                      brandPrimary && TRANSLATE_PRIMARY_CTA_CLASSNAME,
                      brandOutline && TRANSLATE_SECONDARY_OUTLINE_CTA_CLASSNAME
                    )}
                    key={idx}
                  >
                    <Link
                      href={href}
                      target={button.target || '_self'}
                      title={button.title ?? ''}
                    >
                      {button.icon && (
                        <SmartIcon name={button.icon as string} />
                      )}
                      <span>{button.title}</span>
                    </Link>
                  </Button>
                );
              })}
            </div>
          </ScrollAnimation>
        </div>
      </div>
    </section>
  );
}
