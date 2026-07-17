'use client';

import type { ComponentType } from 'react';
import {
  RiAddLine,
  RiBookOpenLine,
  RiBookReadLine,
  RiChat2Line,
  RiCloudy2Fill,
  RiCodeSSlashLine,
  RiCoinsLine,
  RiDeleteBinLine,
  RiDiscordFill,
  RiEditLine,
  RiEyeLine,
  RiFilePdf2Line,
  RiGithubFill,
  RiGoogleFill,
  RiHistoryLine,
  RiKeyLine,
  RiLayoutLine,
  RiLockPasswordLine,
  RiQuestionLine,
  RiRefreshLine,
  RiShieldCheckLine,
  RiSplitCellsHorizontal,
  RiStackLine,
  RiTaskLine,
  RiTranslate2,
  RiTwitterXFill,
  RiUserLine,
} from 'react-icons/ri';

/**
 * Remix Icon 静态注册表。
 *
 * 替代原 SmartIcon 中的 `lazy(() => import('react-icons/ri'))` 整包动态按名取用——
 * 那会把整个 react-icons/ri（~2MB / 473KB gzip）拉入首页。
 * 这里用具名 import，配合 next.config 的 `optimizePackageImports: ['react-icons']`，
 * 仅打包项目实际用到的图标（~5KB），首页不再加载 react-icons 整包。
 *
 * 新增图标：在此 import 并加入下面的映射即可。未注册的 name 会回退到 RiQuestionLine。
 */
export const riIconRegistry: Record<string, ComponentType<any>> = {
  RiAddLine,
  RiBookOpenLine,
  RiBookReadLine,
  RiChat2Line,
  RiCloudy2Fill,
  RiCodeSSlashLine,
  RiCoinsLine,
  RiDeleteBinLine,
  RiDiscordFill,
  RiEditLine,
  RiEyeLine,
  RiFilePdf2Line,
  RiGithubFill,
  RiGoogleFill,
  RiHistoryLine,
  RiKeyLine,
  RiLayoutLine,
  RiLockPasswordLine,
  RiQuestionLine,
  RiRefreshLine,
  RiShieldCheckLine,
  RiSplitCellsHorizontal,
  RiStackLine,
  RiTaskLine,
  RiTranslate2,
  RiTwitterXFill,
  RiUserLine,
};
