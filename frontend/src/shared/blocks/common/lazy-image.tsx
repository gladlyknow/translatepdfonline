import React from 'react';

/**
 * 轻量图片组件：原生 `<img loading="lazy">`，无客户端依赖。
 *
 * 替代原 `react-lazy-load-image-component`（含 blur.css 与 IntersectionObserver），
 * 浏览器原生懒加载即可满足非首屏图需求，省一个客户端依赖与水合点。
 * `unoptimized:true` 下不走 next/image 优化器，故直接用 img 最轻。
 * 未声明 `'use client'`，服务端/客户端组件均可使用。
 */
export function LazyImage({
  src,
  alt,
  className,
  width,
  height,
  placeholderSrc: _placeholderSrc,
  title,
  fill: _fill,
  priority,
  sizes,
  srcSet,
  /** Omit width/height on DOM so parent aspect-ratio box controls layout (e.g. features-list). */
  responsive,
  wrapperClassName: wrapperClassNameProp,
}: {
  src: string;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
  placeholderSrc?: string;
  title?: string;
  fill?: boolean;
  priority?: boolean;
  sizes?: string;
  srcSet?: string;
  responsive?: boolean;
  /** When not `responsive`, optional wrapper (e.g. `block w-full` for intrinsic img layout). */
  wrapperClassName?: string;
}) {
  const img = (
    <img
      src={src}
      alt={alt}
      title={title}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      {...(srcSet ? { srcSet } : {})}
      {...(sizes ? { sizes } : {})}
      // responsive 模式下由外层 aspect-ratio 容器控制尺寸，不写 width/height。
      {...(responsive ? {} : { width, height })}
      className={className}
    />
  );

  if (responsive) {
    return (
      <div className="absolute inset-0 block h-full w-full max-w-full">
        {img}
      </div>
    );
  }

  if (wrapperClassNameProp) {
    return <div className={wrapperClassNameProp}>{img}</div>;
  }

  return img;
}
