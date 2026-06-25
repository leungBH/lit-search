/**
 * lit-search - Progress reporting and cancellation helpers
 *
 * 统一的 MCP progress 上报 + AbortSignal 工具。
 *
 * 设计目标：
 *   - 上层 workflow 不用关心 MCP 协议细节，只调 `report()` 和检查 `signal.aborted`。
 *   - 客户端没要求进度时，函数自动退化为 no-op，不抛错。
 *   - 通知失败不应当影响主流程（吞掉异常）。
 */

import { LitSearchError } from './errors.js';

/**
 * 构造一个 progress reporter + 暴露父 AbortSignal。
 *
 * @param {object} extra - MCP 工具 handler 收到的 extra 参数
 * @param {object} [extra._meta] - 客户端提供的元数据，可能包含 progressToken
 * @param {string} [extra._meta.progressToken] - 客户端订阅的进度 token
 * @param {Function} [extra.sendNotification] - MCP SDK 提供的通知发送器
 * @param {AbortSignal} [extra.signal] - 父 signal（取消时会被 abort）
 * @returns {{ signal: AbortSignal|null, report: Function, isCancelled: Function }}
 */
export function createProgressReporter(extra) {
  const token = extra?._meta?.progressToken;
  const sendNotification = extra?.sendNotification;
  const signal = extra?.signal || null;

  // 客户端没要求进度，或者不是 MCP 上下文 → 静默 no-op
  if (!token || typeof sendNotification !== 'function') {
    return {
      signal,
      report() {
        /* no-op */
      },
      isCancelled: () => Boolean(signal?.aborted),
    };
  }

  let lastProgress = -1;
  let lastMessage = null;

  /**
   * 发送一次进度通知。
   * @param {number} progress - 当前进度（数值）
   * @param {number} [total] - 总进度（可选，0 或 undefined 时不发 total 字段）
   * @param {string} [message] - 人类可读的进度描述
   */
  async function report(progress, total, message) {
    // signal 已 abort 就别发了，省事
    if (signal?.aborted) return;

    let p = Number(progress);
    if (!Number.isFinite(p)) return;
    if (typeof total === 'number' && total > 0) {
      p = Math.max(0, Math.min(p, total));
    }

    // 去重：相同 (progress, message) 不重复发，减少噪声
    if (p === lastProgress && (message || null) === lastMessage) return;
    lastProgress = p;
    lastMessage = message || null;

    const params = { progressToken: token, progress: p };
    if (typeof total === 'number' && total > 0) params.total = total;
    if (message) params.message = message;

    try {
      await sendNotification({
        method: 'notifications/progress',
        params,
      });
    } catch {
      // 通知失败不能影响主流程
    }
  }

  return {
    signal,
    report,
    isCancelled: () => Boolean(signal?.aborted),
  };
}

/**
 * 在长循环 / 关键节点调用。signal 已 abort 时抛 CANCELLED 错误。
 *
 * @param {AbortSignal|null} signal
 * @param {string} [message]
 * @throws {LitSearchError} CANCELLED
 */
export function throwIfCancelled(signal, message = 'Operation cancelled by client') {
  if (signal?.aborted) {
    throw new LitSearchError('CANCELLED', message);
  }
}

/**
 * 检查任意错误是否来自父 signal 的取消。
 * 用于 API client 内部 catch 之后判断是否应当转为 CANCELLED。
 */
export function isCancellationFromSignal(error, signal) {
  if (!signal?.aborted) return false;
  if (!error) return false;
  return error.name === 'AbortError' || error.code === 'ABORT_ERR';
}
