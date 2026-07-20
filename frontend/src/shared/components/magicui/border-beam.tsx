"use client";

import { cn } from "@/shared/lib/utils";

interface BorderBeamProps {
  /**
   * The size of the border beam.
   */
  size?: number;
  /**
   * The duration of the border beam.
   */
  duration?: number;
  /**
   * The delay of the border beam.
   */
  delay?: number;
  /**
   * The color of the border beam from.
   */
  colorFrom?: string;
  /**
   * The color of the border beam to.
   */
  colorTo?: string;
  /**
   * The class name of the border beam.
   */
  className?: string;
  /**
   * The style of the border beam.
   */
  style?: React.CSSProperties;
  /**
   * Whether to reverse the animation direction.
   */
  reverse?: boolean;
  /**
   * The initial offset position (0-100).
   */
  initialOffset?: number;
  /**
   * The border width of the beam.
   */
  borderWidth?: number;
}

/**
 * 光束沿边框环绕的装饰组件。
 * 使用 transform: rotate() 动画（composited），替代 offset-path（非合成）。
 */
export const BorderBeam = ({
  className,
  size = 50,
  delay = 0,
  duration = 6,
  colorFrom = "#ffaa40",
  colorTo = "#9c40ff",
  style,
  reverse = false,
  initialOffset = 0,
  borderWidth = 1,
}: BorderBeamProps) => {
  const phase = reverse ? 100 - initialOffset : initialOffset;
  const animationDelay = -(phase / 100) * duration - delay;

  return (
    <div
      className="pointer-events-none absolute inset-0 rounded-[inherit] border-transparent [mask-clip:padding-box,border-box] [mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)] border-(length:--border-beam-width)"
      style={
        {
          "--border-beam-width": `${borderWidth}px`,
        } as React.CSSProperties
      }
    >
      <div
        className={cn(
          "absolute aspect-square",
          "bg-gradient-to-l from-[var(--color-from)] via-[var(--color-to)] to-transparent",
          className
        )}
        style={
          {
            width: size,
            "--color-from": colorFrom,
            "--color-to": colorTo,
            // 将 beam 置于容器中心，通过 rotate 绕中心旋转，配合 mask 露出边框部分
            top: "50%",
            left: "50%",
            transformOrigin: "center center",
            animation: `border-beam-move ${duration}s linear infinite`,
            animationDirection: reverse ? "reverse" : "normal",
            animationDelay: `${animationDelay}s`,
            ...style,
          } as React.CSSProperties
        }
      />
    </div>
  );
};
