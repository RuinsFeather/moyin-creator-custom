import {
  DEFAULT_SEEDANCE_POST_CHANNEL,
  type SeedancePostChannel,
} from '@/lib/api-key-manager';

/** 完全按照供应商设置构造 Seedance 任务地址，不再根据域名推断通道。 */
export function buildVolcVideoSubmitPath(
  baseUrl: string,
  channel: SeedancePostChannel = DEFAULT_SEEDANCE_POST_CHANNEL,
): string {
  const rootBase = baseUrl
    .replace(/\/+$/, '')
    .replace(/\/(?:api\/v3\/contents\/generations\/tasks|v1\/video\/generations\/tasks|volc\/v1\/contents\/generations\/tasks)$/i, '')
    .replace(/\/(?:api\/v3|v1)$/i, '')
    .replace(/\/+$/, '');
  return `${rootBase}/${channel}`;
}