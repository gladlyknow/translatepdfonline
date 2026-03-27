/** 翻译工作台展示的模型名称（只读；后端实际模型由 FC/环境配置决定） */
export const TRANSLATE_MODEL_DISPLAY_NAME = 'DeepSeek V3';

/**
 * 主 CTA 按钮：与品牌 favicon.svg 对角渐变一致（slate-900 → sky-700 / #0f172a → #0369a1）。
 * 用于翻译工作台「开始翻译」、定价支付、首页 translateDark 主按钮等。
 */
export const TRANSLATE_PRIMARY_CTA_CLASSNAME =
  'border-0 bg-gradient-to-r from-slate-900 to-sky-700 text-white shadow-[0_4px_14px_0_rgba(3,105,161,0.35)] transition-[box-shadow,background-image] hover:from-slate-800 hover:to-sky-600 hover:shadow-[0_6px_20px_0_rgba(3,105,161,0.3)] disabled:opacity-50 dark:from-slate-900 dark:to-sky-600 dark:shadow-[0_4px_18px_0_rgba(56,189,248,0.12)] dark:hover:from-slate-800 dark:hover:to-sky-400 dark:hover:shadow-[0_6px_22px_0_rgba(56,189,248,0.2)]';

/** 积分不足弹窗等：订阅类链接按钮，与主 CTA 同系 slate/sky，避免默认 primary 亮蓝 */
export const TRANSLATE_SECONDARY_OUTLINE_CTA_CLASSNAME =
  'border-slate-300/90 bg-background text-slate-800 shadow-xs hover:border-slate-400 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800/55';

/** 定价卡片价格数字等与 CTA 同系的渐变字 */
export const TRANSLATE_PRIMARY_PRICE_GRADIENT_CLASSNAME =
  'bg-gradient-to-r from-slate-900 to-sky-700 bg-clip-text text-transparent dark:from-sky-300 dark:to-cyan-200';
