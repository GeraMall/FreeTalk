import { useLayoutEffect, type RefObject } from 'react';
/** One shared type size for the entire board, chosen after measuring every street. */
export function usePropertyTypography(ref: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const board = ref.current;
    if (!board) return;
    let alive = true;
    const fit = () => {
      if (!alive || !board.clientWidth) return;
      const labels = [...board.querySelectorAll<HTMLElement>('.mono-street-name')];
      for (const el of labels) {
        const cell = el.parentElement!;
        cell.dataset.monoCompact = String(cell.clientHeight < 30 || cell.clientWidth < 42);
      }
      const boxes = labels.map((el) => {
        const cell = el.parentElement!,
          css = getComputedStyle(cell);
        return {
          el,
          height:
            cell.clientHeight -
            parseFloat(css.paddingTop) -
            parseFloat(css.paddingBottom) -
            (cell.querySelector('small')?.getBoundingClientRect().height ?? 0) -
            (parseFloat(css.rowGap) || 0),
        };
      });
      for (let size = 11; size >= 3.5; size -= 0.25) {
        board.style.setProperty('--mono-street-size', `${size}px`);
        if (
          boxes.every(
            ({ el, height }) =>
              el.scrollWidth <= el.clientWidth + 0.5 && el.scrollHeight <= height + 0.5,
          )
        )
          break;
      }
    };
    fit();
    void document.fonts?.ready.then(fit);
    if (typeof ResizeObserver === 'undefined')
      return () => {
        alive = false;
      };
    const observer = new ResizeObserver(fit);
    observer.observe(board);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [ref]);
}
