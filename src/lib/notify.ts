// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 系统通知工具（跨 Electron / 浏览器）。
 *
 * 主要用途：长耗时任务（如视频生成）完成后，即便用户切到别的窗口，
 * 也能通过 Windows 系统通知得知结果，并可点击通知「快捷跳转」回软件。
 *
 * 优先级：
 *  1. Electron 主进程原生通知（window.appNotification）—— 支持点击按钮聚焦窗口；
 *  2. 浏览器 Notification API —— 点击时尝试 window.focus()；
 *  3. 都不可用时静默忽略（不影响主流程）。
 */

export interface SystemNotifyOptions {
  title: string;
  body?: string;
  /** 点击通知/按钮时是否把软件窗口带到前台，默认 true */
  focusOnClick?: boolean;
  /** 静音（不发提示音） */
  silent?: boolean;
  /** 通知上的按钮文案（Electron/Windows），默认「打开软件」 */
  actionText?: string;
}

/** 是否运行在 Electron（可用原生通知） */
function hasElectronNotification(): boolean {
  return typeof window !== 'undefined' && !!window.appNotification?.show;
}

/**
 * 发送一条系统通知。失败时静默降级，绝不抛出以免影响业务主流程。
 */
export async function sendSystemNotification(options: SystemNotifyOptions): Promise<void> {
  const payload = {
    title: options.title,
    body: options.body,
    focusOnClick: options.focusOnClick !== false,
    silent: options.silent ?? false,
    actionText: options.actionText ?? '打开软件',
  };

  // 1) Electron 原生通知（首选，支持点击按钮聚焦窗口）
  if (hasElectronNotification()) {
    try {
      await window.appNotification!.show(payload);
      return;
    } catch (err) {
      console.warn('[notify] Electron 通知失败，尝试浏览器通知降级:', err);
    }
  }

  // 2) 浏览器 Notification API 降级
  try {
    if (typeof Notification === 'undefined') return;
    const fire = () => {
      const n = new Notification(payload.title, {
        body: payload.body,
        silent: payload.silent,
      });
      if (payload.focusOnClick) {
        n.onclick = () => {
          try {
            window.focus();
          } catch {
            /* ignore */
          }
          n.close();
        };
      }
    };

    if (Notification.permission === 'granted') {
      fire();
    } else if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') fire();
    }
  } catch (err) {
    console.warn('[notify] 浏览器通知失败（已忽略）:', err);
  }
}

/**
 * 便捷方法：视频生成成功通知。
 * @param label 可选的场景/镜头描述，如「分镜 3」，用于区分是哪个任务完成
 */
export function notifyVideoGenerated(label?: string): void {
  const body = label
    ? `${label} 视频已生成完成，点击返回软件查看。`
    : '视频已生成完成，点击返回软件查看。';
  // 不 await：通知是旁路提醒，不阻塞主流程
  void sendSystemNotification({
    title: '🎬 视频生成成功',
    body,
    actionText: '打开软件',
  });
}
