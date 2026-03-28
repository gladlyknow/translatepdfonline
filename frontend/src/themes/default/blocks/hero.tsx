import Image from 'next/image';
import { ArrowRight } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { SmartIcon } from '@/shared/blocks/common';
import { Button } from '@/shared/components/ui/button';
import { Highlighter } from '@/shared/components/ui/highlighter';
import { TRANSLATE_PRIMARY_CTA_CLASSNAME } from '@/config/translate-ui';
import { cn } from '@/shared/lib/utils';
import { Section } from '@/shared/types/blocks/landing';

import { SocialAvatars } from './social-avatars';
import { TranslateHeroHighlighter } from './translate-hero-highlighter';

export function Hero({
  section,
  className,
}: {
  section: Section;
  className?: string;
}) {
  const isTranslateDark = section.variant === 'translateDark';
  const highlightText = section.highlight_text ?? '';
  const heroImageAltFallback =
    section.title?.replace(/<[^>]*>/g, '').trim() ||
    'Translate PDF Online product screenshot';
  let texts = null;
  if (highlightText) {
    texts = section.title?.split(highlightText, 2);
  }

  return (
    <section
      id={section.id}
      className={cn(
        isTranslateDark
          ? 'relative overflow-hidden bg-gradient-to-b from-slate-50 via-sky-50/30 to-zinc-100 pt-20 pb-10 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 md:pt-28 md:pb-14'
          : `pt-24 pb-8 md:pt-36 md:pb-8`,
        !isTranslateDark && section.className,
        className
      )}
    >
      {isTranslateDark && (
        <>
          <div
            className="pointer-events-none absolute inset-0 opacity-30 dark:hidden"
            style={{
              backgroundImage:
                'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(14,165,233,0.22), transparent)',
            }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-0 hidden opacity-40 dark:block"
            style={{
              backgroundImage:
                'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(56,189,248,0.22), transparent)',
            }}
            aria-hidden
          />
        </>
      )}

      {section.announcement && (
        <Link
          href={section.announcement.url || ''}
          target={section.announcement.target || '_self'}
          title={section.announcement.title ?? ''}
          className={cn(
            'group mx-auto mb-8 flex w-fit items-center gap-4 rounded-full border p-1 pl-4 shadow-md transition-colors duration-300',
            isTranslateDark
              ? 'border-zinc-200 bg-white/90 text-zinc-900 shadow-zinc-900/10 hover:bg-white dark:border-white/15 dark:bg-white/10 dark:text-zinc-100 dark:shadow-black/20 dark:hover:bg-white/15'
              : 'hover:bg-background dark:hover:border-t-border bg-muted shadow-zinc-950/5 duration-300 dark:border-t-white/5 dark:shadow-zinc-950'
          )}
        >
          <span
            className={cn(
              'text-sm',
              isTranslateDark ? 'text-zinc-900 dark:text-zinc-100' : 'text-foreground'
            )}
          >
            {section.announcement.title}
          </span>
          <span
            className={cn(
              'block h-4 w-0.5 border-l',
              isTranslateDark
                ? 'border-zinc-300 bg-transparent dark:border-white/25'
                : 'dark:border-background bg-white dark:bg-zinc-700'
            )}
          />

          <div
            className={cn(
              'size-6 overflow-hidden rounded-full duration-500',
              isTranslateDark
                ? 'bg-zinc-100 group-hover:bg-zinc-200 dark:bg-white/15 dark:group-hover:bg-white/25'
                : 'bg-background group-hover:bg-muted'
            )}
          >
            <div className="flex w-12 -translate-x-1/2 duration-500 ease-in-out group-hover:translate-x-0">
              <span className="flex size-6">
                <ArrowRight
                  className={cn(
                    'm-auto size-3',
                    isTranslateDark ? 'text-sky-600 dark:text-sky-200' : ''
                  )}
                />
              </span>
              <span className="flex size-6">
                <ArrowRight
                  className={cn(
                    'm-auto size-3',
                    isTranslateDark ? 'text-sky-600 dark:text-sky-200' : ''
                  )}
                />
              </span>
            </div>
          </div>
        </Link>
      )}

      <div
        className={cn(
          'relative z-[1] mx-auto max-w-full px-4 text-center md:max-w-5xl',
          isTranslateDark && section.className
        )}
      >
        {texts && texts.length > 0 ? (
          <h1
            className={cn(
              'text-4xl font-semibold text-balance sm:mt-12 sm:text-6xl',
              isTranslateDark ? 'text-zinc-900 dark:text-zinc-50' : 'text-foreground'
            )}
          >
            {texts[0]}
            {isTranslateDark ? (
              <TranslateHeroHighlighter>{highlightText}</TranslateHeroHighlighter>
            ) : (
              <Highlighter action="underline" color="#FF9800">
                {highlightText}
              </Highlighter>
            )}
            {texts[1]}
          </h1>
        ) : (
          <h1
            className={cn(
              'text-4xl font-semibold text-balance sm:mt-12 sm:text-6xl',
              isTranslateDark ? 'text-zinc-900 dark:text-zinc-50' : 'text-foreground'
            )}
          >
            {section.title}
          </h1>
        )}

        <p
          className={cn(
            'mt-8 mb-8 text-lg text-balance',
            isTranslateDark ? 'text-zinc-600 dark:text-zinc-300' : 'text-muted-foreground'
          )}
          dangerouslySetInnerHTML={{ __html: section.description ?? '' }}
        />

        {section.buttons && (
          <div className="flex flex-wrap items-center justify-center gap-4">
            {section.buttons.map((button, idx) => {
              const v = button.variant || 'default';
              const darkPrimary =
                isTranslateDark && (v === 'dark' || v === 'default');
              const darkOutline = isTranslateDark && v === 'outline';
              return (
                <Button
                  asChild
                  size={button.size || 'default'}
                  variant={
                    darkPrimary ? 'default' : darkOutline ? 'outline' : v
                  }
                  className={cn(
                    'px-4 text-sm',
                    darkPrimary && TRANSLATE_PRIMARY_CTA_CLASSNAME,
                    darkOutline &&
                      'border-zinc-300 bg-transparent text-zinc-900 shadow-none hover:bg-zinc-100 hover:text-zinc-950 dark:border-white/30 dark:bg-transparent dark:text-zinc-100 dark:hover:bg-white/10 dark:hover:text-white'
                  )}
                  key={idx}
                >
                  <Link
                    href={button.url ?? ''}
                    target={button.target ?? '_self'}
                    title={button.title ?? ''}
                  >
                    {button.icon && <SmartIcon name={button.icon as string} />}
                    <span>{button.title}</span>
                  </Link>
                </Button>
              );
            })}
          </div>
        )}

        {section.tip && (
          <p
            className={cn(
              'mt-6 block text-center text-sm',
              isTranslateDark ? 'text-zinc-500 dark:text-zinc-400' : 'text-muted-foreground'
            )}
            dangerouslySetInnerHTML={{ __html: section.tip ?? '' }}
          />
        )}

        {section.show_avatars && (
          <div
            className={cn(
              isTranslateDark &&
                '[&_p]:text-zinc-600 dark:[&_p]:text-zinc-400 [&_.text-muted-foreground]:text-zinc-600 dark:[&_.text-muted-foreground]:text-zinc-400'
            )}
          >
            <SocialAvatars tip={section.avatars_tip || ''} />
          </div>
        )}
      </div>

      {(section.image?.src || section.image_invert?.src) && (
        <div
          className={cn(
            'relative mt-8 sm:mt-16',
            isTranslateDark
              ? 'border-zinc-200 dark:border-white/10'
              : 'border-foreground/10 border-y'
          )}
        >
          <div
            className={cn(
              'relative z-10 mx-auto max-w-6xl px-3',
              isTranslateDark ? '' : 'border-x'
            )}
          >
            <div
              className={cn(
                isTranslateDark &&
                  'overflow-hidden rounded-xl border border-zinc-200 bg-white/80 ring-1 ring-zinc-200/60 dark:border-white/10 dark:bg-slate-900/40 dark:ring-white/5',
                !isTranslateDark && 'border-x'
              )}
            >
              <div
                aria-hidden
                className={cn(
                  'h-3 w-full bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-5',
                  isTranslateDark && 'opacity-[0.08] dark:opacity-[0.12]'
                )}
              />
              {isTranslateDark ? (
                (section.image_invert?.src || section.image?.src) && (
                  <Image
                    className="relative z-2 block h-auto w-full max-w-full border border-zinc-200 dark:border-white/10"
                    src={
                      section.image_invert?.src ||
                      section.image?.src ||
                      ''
                    }
                    alt={
                      section.image_invert?.alt ||
                      section.image?.alt ||
                      heroImageAltFallback
                    }
                    width={
                      section.image_invert?.width ||
                      section.image?.width ||
                      3840
                    }
                    height={
                      section.image_invert?.height ||
                      section.image?.height ||
                      2424
                    }
                    sizes="(max-width: 768px) 100vw, 1200px"
                    loading="lazy"
                    fetchPriority="high"
                    quality={75}
                    unoptimized={(
                      section.image_invert?.src || section.image?.src || ''
                    ).startsWith('http')}
                  />
                )
              ) : (
                <>
                  {section.image_invert?.src && (
                    <Image
                      className="border-border/25 relative z-2 hidden w-full border dark:block"
                      src={section.image_invert.src}
                      alt={
                        section.image_invert.alt ||
                        section.image?.alt ||
                        heroImageAltFallback
                      }
                      width={
                        section.image_invert.width || section.image?.width || 1200
                      }
                      height={
                        section.image_invert.height ||
                        section.image?.height ||
                        630
                      }
                      sizes="(max-width: 768px) 100vw, 1200px"
                      loading="lazy"
                      fetchPriority="high"
                      quality={75}
                      unoptimized={section.image_invert.src.startsWith('http')}
                    />
                  )}
                  {section.image?.src && (
                    <Image
                      className="border-border/25 relative z-2 block w-full border dark:hidden"
                      src={section.image.src}
                      alt={
                        section.image.alt ||
                        section.image_invert?.alt ||
                        heroImageAltFallback
                      }
                      width={
                        section.image.width || section.image_invert?.width || 1200
                      }
                      height={
                        section.image.height ||
                        section.image_invert?.height ||
                        630
                      }
                      sizes="(max-width: 768px) 100vw, 1200px"
                      loading="lazy"
                      fetchPriority="high"
                      quality={75}
                      unoptimized={section.image.src.startsWith('http')}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {!isTranslateDark && section.background_image?.src && (
        <div className="absolute inset-0 -z-10 hidden h-full w-full overflow-hidden md:block">
          <div className="from-background/80 via-background/80 to-background absolute inset-0 z-10 bg-gradient-to-b" />
          <Image
            src={section.background_image.src}
            alt={section.background_image.alt || heroImageAltFallback}
            className="object-cover opacity-60 blur-[0px]"
            fill
            loading="lazy"
            sizes="(max-width: 768px) 0vw, 100vw"
            quality={70}
            unoptimized={section.background_image.src.startsWith('http')}
          />
        </div>
      )}
    </section>
  );
}
