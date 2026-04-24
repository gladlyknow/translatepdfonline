import { envConfigs } from '..';

export const localeNames: any = {
  en: 'English',
  zh: '中文',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  el: 'Ελληνικά',
  ja: '日本語',
  ko: '한국어',
  de: 'Deutsch',
  ru: 'Русский',
};

export const locales = ['en', 'zh', 'es', 'fr', 'it', 'el', 'ja', 'ko', 'de', 'ru'];

export const defaultLocale = envConfigs.locale;

export const localePrefix = 'as-needed';

export const localeDetection = false;

export const localeMessagesRootPath = '@/config/locale/messages';

export const localeMessagesPaths = [
  'common',
  'landing',
  'settings/sidebar',
  'settings/profile',
  'settings/security',
  'settings/billing',
  'settings/payments',
  'settings/credits',
  'settings/apikeys',
  'admin/sidebar',
  'admin/users',
  'admin/roles',
  'admin/permissions',
  'admin/categories',
  'admin/posts',
  'admin/payments',
  'admin/subscriptions',
  'admin/credits',
  'admin/settings',
  'admin/apikeys',
  'admin/ai-tasks',
  'admin/chats',
  'ai/music',
  'ai/chat',
  'ai/image',
  'ai/video',
  'activity/sidebar',
  'activity/ai-tasks',
  'activity/chats',
  'pages/index',
  'pages/pricing',
  'pages/showcases',
  'pages/blog',
  'pages/updates',
  'translate/pdfViewer',
  'translate/upload',
  'translate/translate',
  'translate/task',
  'translate/errors',
  'translate/home',
  'translate/shell',
  'translate/languages',
  'translate/ocrWorkbench',
];
