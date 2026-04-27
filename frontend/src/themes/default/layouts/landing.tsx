import { ReactNode } from 'react';

import { getThemeBlock } from '@/core/theme';
import { TranslateHistoryDrawerProvider } from '@/shared/contexts/translate-history-drawer';
import {
  Footer as FooterType,
  Header as HeaderType,
} from '@/shared/types/blocks/landing';
import { FooterWithTranslateBehavior } from '../blocks/FooterWithTranslateBehavior';
import { HeaderWithTranslateBehavior } from '../blocks/HeaderWithTranslateBehavior';

export default async function LandingLayout({
  children,
  header,
  footer,
}: {
  children: ReactNode;
  header: HeaderType;
  footer: FooterType;
}) {
  const Header = await getThemeBlock('header');
  const Footer = await getThemeBlock('footer');

  return (
    <TranslateHistoryDrawerProvider>
      <div className="flex min-h-screen w-full flex-col">
        <HeaderWithTranslateBehavior>
          <Header header={header} />
        </HeaderWithTranslateBehavior>
        <main className="w-full flex-1">{children}</main>
        <FooterWithTranslateBehavior>
          <Footer footer={footer} />
        </FooterWithTranslateBehavior>
      </div>
    </TranslateHistoryDrawerProvider>
  );
}
