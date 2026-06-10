import { envConfigs } from '@/config';
import { defaultTheme } from '@/config/theme';

// 模块级缓存：避免同一 Worker 实例中重复 import() 同一文件
// 虽然 Worker 冷启动时缓存丢失，但在同一实例处理多个请求时有效
const pageCache = new Map<string, any>();
const layoutCache = new Map<string, any>();
const blockCache = new Map<string, any>();

/**
 * get active theme
 */
export function getActiveTheme(): string {
  const theme = envConfigs.theme as string;

  if (theme) {
    return theme;
  }

  return defaultTheme;
}

/**
 * load theme page
 */
export async function getThemePage(pageName: string, theme?: string) {
  const loadTheme = theme || getActiveTheme();
  const cacheKey = `${loadTheme}:${pageName}`;

  if (pageCache.has(cacheKey)) {
    return pageCache.get(cacheKey);
  }

  // 已经是 default 主题则不需要 fallback
  if (loadTheme === defaultTheme) {
    const module = await import(`@/themes/${defaultTheme}/pages/${pageName}`);
    pageCache.set(cacheKey, module.default);
    return module.default;
  }

  // 非 default 主题：先尝试加载，失败则 fallback 到 default
  try {
    const module = await import(`@/themes/${loadTheme}/pages/${pageName}`);
    pageCache.set(cacheKey, module.default);
    return module.default;
  } catch {
    const fallbackModule = await import(
      `@/themes/${defaultTheme}/pages/${pageName}`
    );
    pageCache.set(cacheKey, fallbackModule.default);
    return fallbackModule.default;
  }
}

/**
 * load theme layout
 */
export async function getThemeLayout(layoutName: string, theme?: string) {
  const loadTheme = theme || getActiveTheme();
  const cacheKey = `${loadTheme}:${layoutName}`;

  if (layoutCache.has(cacheKey)) {
    return layoutCache.get(cacheKey);
  }

  if (loadTheme === defaultTheme) {
    const module = await import(`@/themes/${defaultTheme}/layouts/${layoutName}`);
    layoutCache.set(cacheKey, module.default);
    return module.default;
  }

  try {
    const module = await import(`@/themes/${loadTheme}/layouts/${layoutName}`);
    layoutCache.set(cacheKey, module.default);
    return module.default;
  } catch {
    const fallbackModule = await import(
      `@/themes/${defaultTheme}/layouts/${layoutName}`
    );
    layoutCache.set(cacheKey, fallbackModule.default);
    return fallbackModule.default;
  }
}

/**
 * convert kebab-case to PascalCase
 */
function kebabToPascalCase(str: string): string {
  return str
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * load theme block
 */
export async function getThemeBlock(blockName: string, theme?: string) {
  const loadTheme = theme || getActiveTheme();
  const pascalCaseName = kebabToPascalCase(blockName);
  const cacheKey = `${loadTheme}:${blockName}`;

  if (blockCache.has(cacheKey)) {
    const cached = blockCache.get(cacheKey);
    return cached[pascalCaseName] || cached[blockName];
  }

  if (loadTheme === defaultTheme) {
    const module = await import(`@/themes/${defaultTheme}/blocks/${blockName}`);
    blockCache.set(cacheKey, module);
    const component = module[pascalCaseName] || module[blockName];
    if (!component) {
      throw new Error(`No valid export found in block "${blockName}"`);
    }
    return component;
  }

  // 非 default 主题：先尝试，失败则 fallback
  try {
    const module = await import(`@/themes/${loadTheme}/blocks/${blockName}`);
    blockCache.set(cacheKey, module);
    const component = module[pascalCaseName] || module[blockName];
    if (!component) {
      throw new Error(`No valid export found in block "${blockName}"`);
    }
    return component;
  } catch {
    const fallbackModule = await import(
      `@/themes/${defaultTheme}/blocks/${blockName}`
    );
    blockCache.set(`${defaultTheme}:${blockName}`, fallbackModule);
    const fallbackComponent =
      fallbackModule[pascalCaseName] || fallbackModule[blockName];
    if (!fallbackComponent) {
      throw new Error(
        `No valid export found in fallback block "${blockName}"`
      );
    }
    return fallbackComponent;
  }
}
