"use client";

import React, { useEffect, useRef } from "react";

interface ScrollAnimationProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  direction?: "up" | "down" | "left" | "right";
  stagger?: boolean;
}

/**
 * 原生 IntersectionObserver + CSS 驱动的滚动入场动画。
 *
 * 不再依赖 framer-motion，首页可彻底去除 vendor-animation chunk。
 * 初始隐藏态由 `.js .scroll-anim`（global.css）控制：仅当 html 带 `js` 类时隐藏，
 * 无 JS / 爬虫场景下内容直接展示，保证 SEO 与可访问性。
 * 动画曲线与原 framer-motion 实现一致（cubic-bezier(0.22,1,0.36,1)）。
 */
export function ScrollAnimation({
  children,
  className = "",
  delay = 0,
  direction = "up",
  stagger = false,
}: ScrollAnimationProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // 不支持 IntersectionObserver 时直接展示，避免内容永久隐藏。
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-visible");
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0, rootMargin: "-50px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const offset = (() => {
    switch (direction) {
      case "up":
        return { x: "0px", y: "30px" };
      case "down":
        return { x: "0px", y: "-30px" };
      case "left":
        return { x: "30px", y: "0px" };
      case "right":
        return { x: "-30px", y: "0px" };
      default:
        return { x: "0px", y: "30px" };
    }
  })();

  const style: React.CSSProperties = {
    // CSS 变量驱动初始位移与延迟，CSS 中定义过渡曲线。
    ["--sa-x" as string]: offset.x,
    ["--sa-y" as string]: offset.y,
    ["--sa-delay" as string]: `${delay}s`,
  };

  if (stagger) {
    return (
      <div ref={ref} className={`scroll-anim ${className}`} style={style}>
        {React.Children.map(children, (child, index) => (
          <div
            className="scroll-anim-item"
            style={{ ["--sa-i" as string]: index }}
          >
            {child}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div ref={ref} className={`scroll-anim ${className}`} style={style}>
      {children}
    </div>
  );
}
