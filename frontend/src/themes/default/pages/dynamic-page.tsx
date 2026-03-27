import { getThemeBlock } from '@/core/theme';
import type { DynamicPage as DynamicPageType } from '@/shared/types/blocks/landing';

export default async function DynamicPage({
  locale,
  page,
  data,
}: {
  locale?: string;
  page: DynamicPageType;
  data?: Record<string, any>;
}) {
  const sections = page.sections;
  const sectionKeys =
    sections == null
      ? []
      : page.show_sections != null
        ? page.show_sections.filter((k) => sections[k] != null)
        : Object.keys(sections);

  const blocks = await Promise.all(
    sectionKeys.map(async (sectionKey: string) => {
      const section = sections?.[sectionKey];
      if (!section || section.disabled === true) {
        return null;
      }

      const block = section.block || section.id || sectionKey;

      switch (block) {
        default:
          try {
            if (section.component) {
              return section.component;
            }

            const DynamicBlock = await getThemeBlock(block);
            return (
              <DynamicBlock
                key={sectionKey}
                section={section}
                {...(data || section.data || {})}
              />
            );
          } catch {
            return null;
          }
      }
    })
  );

  return (
    <>
      {page.title && !page.sections?.hero && (
        <h1 className="sr-only">{page.title}</h1>
      )}
      {blocks}
    </>
  );
}
