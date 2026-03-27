import { ReactNode } from 'react';

import { getThemeBlock } from '@/core/theme';
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
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <HeaderWithTranslateBehavior>
        <Header header={header} />
      </HeaderWithTranslateBehavior>
      <main className="min-h-0 flex-1 overflow-auto">
        {children}
      </main>
      <FooterWithTranslateBehavior>
        <Footer footer={footer} />
      </FooterWithTranslateBehavior>
    </div>
  );
}
