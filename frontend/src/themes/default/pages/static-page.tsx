import { getThemeBlock } from '@/core/theme';

export default async function StaticPage({
  locale,
  post,
}: {
  locale?: string;
  post: {
    id: string;
    title: string;
    description?: string;
    created_at?: string;
    body?: React.ReactNode;
    content?: string;
  };
}) {
  const PageDetail = await getThemeBlock('page-detail');

  return <PageDetail post={post} />;
}
