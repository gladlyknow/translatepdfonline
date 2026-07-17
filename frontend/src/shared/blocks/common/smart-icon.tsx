'use client';

import { ComponentType, lazy, Suspense } from 'react';

import { riIconRegistry } from '@/shared/blocks/common/ri-icon-registry';

const iconCache: { [key: string]: ComponentType<any> } = {};

// Function to automatically detect icon library
function detectIconLibrary(name: string): 'ri' | 'lucide' {
  if (name && name.startsWith('Ri')) {
    return 'ri';
  }

  return 'lucide';
}

export function SmartIcon({
  name,
  size = 24,
  className,
  ...props
}: {
  name: string;
  size?: number;
  className?: string;
  [key: string]: any;
}) {
  const library = detectIconLibrary(name);
  const cacheKey = `${library}-${name}`;

  if (!iconCache[cacheKey]) {
    if (library === 'ri') {
      // Remix Icons：从静态注册表按名取用（仅打包项目用到的图标），
      // 替代原整包 `import('react-icons/ri')`（~2MB / 473KB gzip）。
      iconCache[cacheKey] =
        riIconRegistry[name] || riIconRegistry.RiQuestionLine;
    } else {
      // Lucide React (default)
      iconCache[cacheKey] = lazy(async () => {
        try {
          const module = await import('lucide-react');
          const IconComponent = module[name as keyof typeof module];
          if (IconComponent) {
            return { default: IconComponent as ComponentType<any> };
          } else {
            console.warn(
              `Icon "${name}" not found in lucide-react, using fallback`
            );
            return { default: module.HelpCircle as ComponentType<any> };
          }
        } catch (error) {
          console.error(`Failed to load lucide-react:`, error);
          const fallbackModule = await import('lucide-react');
          return { default: fallbackModule.HelpCircle as ComponentType<any> };
        }
      });
    }
  }

  const IconComponent = iconCache[cacheKey];

  // ri 注册表返回的是同步组件，无需 Suspense；lucide 仍是 lazy 需要 Suspense。
  if (library === 'ri') {
    return <IconComponent size={size} className={className} {...props} />;
  }

  return (
    <Suspense fallback={<div style={{ width: size, height: size }} />}>
      <IconComponent size={size} className={className} {...props} />
    </Suspense>
  );
}
