import { setRequestLocale } from 'next-intl/server';
import CompareResultPageClient from '@/shared/blocks/document-compare/compare-result-page';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

export default async function ContractComparisonResultPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  return <CompareResultPageClient jobId={id} />;
}
