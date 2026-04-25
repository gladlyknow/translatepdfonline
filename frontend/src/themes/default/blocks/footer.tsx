import { Link } from '@/core/i18n/navigation';
import {
  BrandLogo,
  BuiltWith,
  Copyright,
  LocaleSelector,
  ThemeToggler,
} from '@/shared/blocks/common';
import { SmartIcon } from '@/shared/blocks/common/smart-icon';
import { NavItem } from '@/shared/types/blocks/common';
import { Footer as FooterType } from '@/shared/types/blocks/landing';

const supportMailtoClass =
  'text-sky-600 font-medium underline decoration-sky-600/50 underline-offset-2 transition-colors hover:text-sky-700 hover:decoration-sky-700 dark:text-sky-400 dark:decoration-sky-400/50 dark:hover:text-sky-300';

function brandDescriptionLooksLikeHtml(s: string): boolean {
  return /<[a-z][\s\S]*>/i.test(s);
}

/** Highlight processor name for any locale where it appears as "Creem". */
function PaymentsWithCreemHighlight({ text }: { text: string }) {
  const parts = text.split(/(Creem)/gi);
  return (
    <p className="text-muted-foreground">
      {parts.map((part, i) =>
        part.toLowerCase() === 'creem' ? (
          <span key={i} className="text-foreground font-medium">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </p>
  );
}

export function Footer({ footer }: { footer: FooterType }) {
  const supportEmail = footer.support_email?.trim();
  const supportLabel = footer.support_label ?? 'Support:';
  const payments = footer.payments_statement?.trim();

  return (
    <footer
      id={footer.id}
      className={`bg-background text-foreground border-border border-t py-6 sm:py-8 ${footer.className || ''} overflow-x-hidden`}
    >
      <div className="container max-w-full space-y-6 px-4 sm:px-6 lg:px-8 sm:space-y-8">
        <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-8">
          <div className="min-w-0 max-w-2xl space-y-2 break-words">
            {footer.brand ? <BrandLogo brand={footer.brand} /> : null}

            {footer.brand?.description ? (
              <p className="text-muted-foreground text-sm text-balance break-words [&_a]:cursor-pointer [&_a]:font-semibold [&_a]:text-primary [&_a]:underline [&_a]:decoration-primary [&_a]:underline-offset-[3px] [&_a:hover]:text-primary/90">
                {brandDescriptionLooksLikeHtml(footer.brand.description) ? (
                  <span
                    dangerouslySetInnerHTML={{
                      __html: footer.brand.description,
                    }}
                  />
                ) : (
                  footer.brand.description
                )}
              </p>
            ) : null}
          </div>

          <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-3 sm:gap-4 md:pt-0.5">
            {footer.show_built_with !== false ? <BuiltWith /> : null}
            <div className="min-w-0 flex-1 md:hidden" />
            {footer.show_theme !== false ? <ThemeToggler type="toggle" /> : null}
            {footer.show_locale !== false ? (
              <LocaleSelector type="button" />
            ) : null}
          </div>
        </div>

        {footer.nav?.items?.length ? (
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
            {footer.nav.items.map((item, idx) => (
              <div
                key={idx}
                className="min-w-0 space-y-2 text-sm break-words"
              >
                <span className="block font-medium break-words">
                  {item.title}
                </span>

                <div className="flex min-w-0 flex-wrap gap-2 sm:flex-col">
                  {item.children?.map((subItem, iidx) => (
                    <Link
                      key={iidx}
                      href={subItem.url || ''}
                      target={subItem.target || ''}
                      title={subItem.title || ''}
                      className="text-muted-foreground hover:text-primary block break-words duration-150"
                    >
                      <span className="break-words">{subItem.title || ''}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div
          aria-hidden
          className="h-px min-w-0 [background-image:linear-gradient(90deg,var(--color-foreground)_1px,transparent_1px)] bg-[length:6px_1px] bg-repeat-x opacity-25"
        />

        {/* 居中分行：法律链接 → Support / 支付 → 社交 → 版权（SaaS 合规常见版式） */}
        <div className="mx-auto max-w-2xl space-y-5 pb-2 text-center">
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm font-medium text-muted-foreground">
            <Link href="/" className="hover:text-foreground transition-colors duration-150">
              Translate PDF Online
            </Link>
            <Link
              href="/translate"
              className="hover:text-foreground transition-colors duration-150"
            >
              PDF Translate
            </Link>
            <Link
              href="/ocrtranslator"
              className="hover:text-foreground transition-colors duration-150"
            >
              PDF OCR
            </Link>
            <Link
              href="/pricing"
              className="hover:text-foreground transition-colors duration-150"
            >
              Pricing
            </Link>
          </div>

          {footer.agreement?.items?.length ? (
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-medium text-muted-foreground">
              {footer.agreement.items.map((item: NavItem, index: number) => (
                <Link
                  key={index}
                  href={item.url || ''}
                  target={item.target || ''}
                  className="hover:text-foreground transition-colors duration-150"
                >
                  {item.title || ''}
                </Link>
              ))}
            </div>
          ) : null}

          {supportEmail ? (
            <div className="text-muted-foreground space-y-2 text-sm">
              <p>
                <span className="font-medium text-foreground">
                  {supportLabel}
                </span>{' '}
                <a
                  href={`mailto:${supportEmail}`}
                  className={supportMailtoClass}
                  title={`${supportLabel} ${supportEmail}`}
                >
                  {supportEmail}
                </a>
              </p>
              {payments ? <PaymentsWithCreemHighlight text={payments} /> : null}
            </div>
          ) : null}

          {footer.social?.items?.length ? (
            <div className="flex justify-center gap-2">
              {footer.social.items.map((item: NavItem, index) => (
                <Link
                  key={index}
                  href={item.url || ''}
                  target={item.target || ''}
                  title={item.title || ''}
                  className="text-muted-foreground hover:text-foreground bg-background inline-flex cursor-pointer rounded-full p-2 transition-colors duration-150"
                  aria-label={item.title || 'Social media link'}
                >
                  {item.icon && (
                    <SmartIcon name={item.icon as string} size={20} />
                  )}
                </Link>
              ))}
            </div>
          ) : null}

          <div className="text-muted-foreground/90 border-border/40 mt-2 border-t pt-5 text-xs">
            {footer.copyright ? (
              <span
                dangerouslySetInnerHTML={{ __html: footer.copyright }}
              />
            ) : footer.brand ? (
              <Copyright
                brand={footer.brand}
                className="text-muted-foreground/90 justify-center text-xs"
              />
            ) : null}
          </div>
        </div>
      </div>
    </footer>
  );
}
