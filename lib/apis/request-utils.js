/**
 * Shared helpers for API request timeout/cancellation handling.
 */

export function createRequestSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();

  const onParentAbort = () => {
    controller.abort(parentSignal?.reason || new Error('请求已取消'));
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      onParentAbort();
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`请求超时（${Math.ceil(timeoutMs / 1000)}秒）`));
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeoutId);
      if (parentSignal) {
        parentSignal.removeEventListener('abort', onParentAbort);
      }
    }
  };
}

export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}
