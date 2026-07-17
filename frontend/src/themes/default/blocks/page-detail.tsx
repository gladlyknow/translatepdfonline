import { CalendarIcon, TimerIcon } from 'lucide-react';

import { MarkdownPreview } from '@/shared/blocks/common/markdown-preview';
// BlogPostType is used for static pages (privacy-policy, terms-of-service)
type PostType = {
  id: string;
  title: string;
  description?: string;
  created_at?: string;
  body?: React.ReactNode;
  content?: string;
};

// 注意：docs.css（fumadocs 样式）已移至路由级 [...slug]/page.tsx 导入。
// 此前在此处 import 会被 getThemeBlock 动态 context 急切打包进首页 CSS（~34KB gzip）。

export async function PageDetail({ post }: { post: PostType }) {
  return (
    <section id={post.id}>
      <div className="py-24 md:py-32">
        <div className="mx-auto w-full max-w-4xl px-6 md:px-8">
          <div className="mt-16 text-center">
            <h1 className="text-foreground mx-auto mb-4 w-full text-xl font-bold md:max-w-4xl md:text-4xl">
              {post.title}
            </h1>
            <div className="text-muted-foreground text-md mb-8 flex items-center justify-center gap-4">
              {post.description}
            </div>
            {post.created_at && (
              <div className="text-muted-foreground text-md mb-8 flex items-center justify-center gap-2">
                <CalendarIcon className="size-4" /> {post.created_at}
              </div>
            )}
          </div>

          <div className="ring-foreground/5 relative mt-8 rounded-3xl border border-transparent px-4 shadow ring-1 md:px-8">
            <div>
              {post.body ? (
                <div className="docs text-foreground text-md my-8 space-y-4 font-normal *:leading-relaxed">
                  {post.body}
                </div>
              ) : (
                <>
                  {post.content && (
                    <div className="text-muted-foreground my-8 space-y-4 text-lg *:leading-relaxed">
                      <MarkdownPreview content={post.content} />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
