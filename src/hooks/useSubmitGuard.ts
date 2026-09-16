import { useCallback, useRef, useState } from 'react';

export function useSubmitGuard() {
  const busyRef = useRef(false);
  const [pending, setPending] = useState(false);

  const guard = useCallback(async (fn?: () => void | Promise<void>): Promise<boolean> => {
    if (!fn || busyRef.current) return false;

    busyRef.current = true;
    setPending(true);
    try {
      await fn();
      return true;
    } catch (err: unknown) {
      console.error('[useSubmitGuard] 提交回调抛出异常:', err);
      return false;
    } finally {
      busyRef.current = false;
      setPending(false);
    }
  }, []);

  return { pending, guard };
}
