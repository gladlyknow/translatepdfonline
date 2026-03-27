import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import { getThemeBlock } from '@/core/theme';
import type {
  Footer as FooterType,
  Header as HeaderType,
} from '@/shared/types/blocks/landing';
import { FooterWithTranslateBehavior } from '@/themes/default/blocks/FooterWithTranslateBehavior';

import { TranslateAppShell } from './TranslateAppShell';

export default async function TranslateGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  const t = await getTranslations('landing');
  const footer = t.raw('footer') as FooterType;
  const landingHeader = t.raw('header') as HeaderType;
  const Footer = await getThemeBlock('footer');

  return (
    <TranslateAppShell
      userNav={landingHeader.user_nav}
      footer={
        <FooterWithTranslateBehavior>
          <Footer footer={footer} />
        </FooterWithTranslateBehavior>
      }
    >
      {children}
    </TranslateAppShell>
  );
}
