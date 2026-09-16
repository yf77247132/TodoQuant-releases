import { useEffect, type RefObject } from 'react';

export function useScrollChaining(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const findScrollableParent = (node: HTMLElement): HTMLElement | null => {
      let cur = node.parentElement;
      while (cur) {
        const style = window.getComputedStyle(cur);
        const oy = style.overflowY;
        if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && cur.scrollHeight > cur.clientHeight) {
          return cur;
        }
        cur = cur.parentElement;
      }
      return null;
    };

    const normalizeDelta = (e: WheelEvent, clientHeight: number): number => {
      switch (e.deltaMode) {
        case 1: return e.deltaY * 16;
        case 2: return e.deltaY * clientHeight;
        default: return e.deltaY;
      }
    };

    const handleWheel = (e: WheelEvent) => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const atTop = scrollTop <= 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
      const chainUp = atTop && e.deltaY < 0;
      const chainDown = atBottom && e.deltaY > 0;
      if (!chainUp && !chainDown) return;

      const parent = findScrollableParent(el);
      if (!parent) return;

      e.preventDefault();
      e.stopPropagation();
      parent.scrollTop += normalizeDelta(e, parent.clientHeight);
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [ref]);
}
