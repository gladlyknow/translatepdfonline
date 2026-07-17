export * from './smart-icon';

export * from './pagination';

export * from './brand-logo';

export * from './locale-detector';
export * from './locale-selector';
export * from './top-banner';

export * from './theme-toggler';

export * from './copyright';
export * from './built-with';

export * from './page-header';
export * from './section-header';

export * from './empty';
export * from './lazy-image';
export * from './image-uploader';
// markdown-preview / markdown-content / markdown-editor / mdx-content 已从 barrel 移除：
// 它们经 @/mdx-components → fumadocs-ui/mdx（CSS 副作用）把 fumadocs CSS（~34KB gzip）
// 泄漏进每个 import barrel 的页面（含首页）。改用直接 import 子模块路径。
// 例：import { MarkdownPreview } from '@/shared/blocks/common/markdown-preview';

export * from '../sign/sign-user';

export * from './audio-player';

export * from './error-boundary';
