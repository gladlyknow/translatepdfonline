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

export function Footer({ footer }: { footer: FooterType }) {
  return (
    <footer
      id={footer.id}
      className={`bg-background text-foreground border-border border-t py-[calc(2rem*4/9)] sm:py-[calc(2rem*4/9)] ${footer.className || ''} overflow-x-hidden`}
      // overflow-x-hidden防止-footer-撑出水平滚动条
    >
      <div className="container space-y-[calc(2rem*2/3)] overflow-x-hidden">
        <div className="grid min-w-0 gap-[calc(3rem*2/3)] md:grid-cols-5">
          <div className="min-w-0 space-y-[calc(1rem*2/3)] break-words md:col-span-2 md:space-y-[calc(1.5rem*2/3)]">
            {footer.brand ? <BrandLogo brand={footer.brand} /> : null}

            {footer.brand?.description ? (
              <p
                className="text-muted-foreground text-sm text-balance break-words"
                dangerouslySetInnerHTML={{ __html: footer.brand.description }}
              />
            ) : null}
          </div>

          <div className="col-span-3 grid min-w-0 gap-[calc(1.5rem*4/9)] sm:grid-cols-3">
            {footer.nav?.items.map((item, idx) => (
              <div
                key={idx}
                className="min-w-0 space-y-[calc(1rem*4/9)] text-sm break-words"
              >
                <span className="block font-medium break-words">
                  {item.title}
                </span>

                <div className="flex min-w-0 flex-wrap gap-[calc(1rem*4/9)] sm:flex-col">
                  {item.children?.map((subItem, iidx) => (
                    <Link
                      key={iidx}
                      href={subItem.url || ''}
                      target={subItem.target || ''}
                      className="text-muted-foreground hover:text-primary block break-words duration-150"
                    >
                      <span className="break-words">{subItem.title || ''}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-[calc(1rem*4/9)] sm:gap-[calc(2rem*4/9)]">
          {footer.show_built_with !== false ? <BuiltWith /> : null}
          <div className="min-w-0 flex-1" />
          {footer.show_theme !== false ? <ThemeToggler type="toggle" /> : null}
          {footer.show_locale !== false ? (
            <LocaleSelector type="button" />
          ) : null}
        </div>

        <div
          aria-hidden
          className="h-px min-w-0 [background-image:linear-gradient(90deg,var(--color-foreground)_1px,transparent_1px)] bg-[length:6px_1px] bg-repeat-x opacity-25"
        />
        <div className="flex min-w-0 flex-wrap justify-between gap-[calc(2rem*4/9)]">
          {footer.copyright ? (
            <p
              className="text-muted-foreground text-sm text-balance break-words"
              dangerouslySetInnerHTML={{ __html: footer.copyright }}
            />
          ) : footer.brand ? (
            <Copyright brand={footer.brand} />
          ) : null}

          <div className="min-w-0 flex-1"></div>

          {footer.agreement ? (
            <div className="flex min-w-0 flex-wrap items-center gap-[calc(1rem*2/3)]">
              {footer.agreement?.items.map((item: NavItem, index: number) => (
                <Link
                  key={index}
                  href={item.url || ''}
                  target={item.target || ''}
                  className="text-muted-foreground hover:text-primary block text-xs break-words underline duration-150"
                >
                  {item.title || ''}
                </Link>
              ))}
            </div>
          ) : null}

          {footer.social ? (
            <div className="flex min-w-0 flex-wrap items-center gap-[calc(0.5rem*4/9)]">
              {footer.social?.items.map((item: NavItem, index) => (
                <Link
                  key={index}
                  href={item.url || ''}
                  target={item.target || ''}
                  className="text-muted-foreground hover:text-primary bg-background block cursor-pointer rounded-full p-[calc(0.5rem*4/9)] duration-150"
                  aria-label={item.title || 'Social media link'}
                >
                  {item.icon && (
                    <SmartIcon name={item.icon as string} size={20} />
                  )}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
