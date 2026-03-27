'use client';

import { LazyLoadImage } from 'react-lazy-load-image-component';

import 'react-lazy-load-image-component/src/effects/blur.css';

export function LazyImage({
  src,
  alt,
  className,
  width,
  height,
  placeholderSrc,
  title,
  fill,
  priority,
  sizes,
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
  responsive?: boolean;
  /** When not `responsive`, optional wrapper (e.g. `block w-full` for intrinsic img layout). */
  wrapperClassName?: string;
}) {
  return (
    <LazyLoadImage
      src={src}
      alt={alt}
      width={responsive ? undefined : width}
      height={responsive ? undefined : height}
      effect="blur" // 支持 blur、opacity 等
      placeholderSrc={placeholderSrc} // 可选
      className={className}
      wrapperClassName={
        responsive
          ? '!absolute inset-0 block h-full w-full max-w-full'
          : wrapperClassNameProp
      }
    />
  );
}
