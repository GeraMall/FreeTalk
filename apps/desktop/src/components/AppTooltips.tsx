import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function AppTooltips() {
  const [tip, setTip] = useState<{ anchor: HTMLElement; text: string }>();
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let anchor: HTMLElement | null = null;
    let timer: number | undefined;
    const findAnchor = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>('[data-tooltip]') : null;
    const dismiss = () => {
      window.clearTimeout(timer);
      anchor = null;
      setTip(undefined);
    };
    const show = (next: HTMLElement | null) => {
      if (anchor === next) return;
      dismiss();
      if (!next?.dataset.tooltip || next.closest('[data-tooltip-suspended]')) return;
      anchor = next;
      timer = window.setTimeout(() => {
        const text = next.dataset.tooltip;
        if (next.isConnected && text && !next.closest('[data-tooltip-suspended]')) {
          setTip({ anchor: next, text });
        }
      }, 450);
    };
    const hover = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') show(findAnchor(event.target));
    };
    const leave = (event: PointerEvent | FocusEvent) => {
      if (
        anchor &&
        findAnchor(event.target) === anchor &&
        findAnchor(event.relatedTarget) !== anchor
      )
        dismiss();
    };
    const focus = (event: FocusEvent) => {
      const target = findAnchor(event.target);
      if (target?.matches(':focus-visible')) show(target);
    };
    const keydown = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' ||
        (anchor?.closest('[data-tooltip-below]') &&
          (event.key === 'Enter' ||
            (event.target === anchor && anchor instanceof HTMLInputElement)))
      )
        dismiss();
    };

    document.addEventListener('pointerover', hover);
    document.addEventListener('pointerout', leave);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', leave);
    document.addEventListener('keydown', keydown);
    document.addEventListener('submit', dismiss, true);
    document.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerover', hover);
      document.removeEventListener('pointerout', leave);
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', leave);
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('submit', dismiss, true);
      document.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, []);

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!tip || !tooltip) return;
    const anchor = tip.anchor.getBoundingClientRect();
    const { width, height } = tooltip.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(window.innerWidth - width - 8, anchor.left + (anchor.width - width) / 2),
    );
    const below = anchor.bottom + 8;
    const above = anchor.top - height - 8;
    const preferBelow = Boolean(tip.anchor.closest('[data-tooltip-below]'));
    const top =
      preferBelow && below + height <= window.innerHeight - 8 ? below : above >= 8 ? above : below;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(8, Math.min(window.innerHeight - height - 8, top))}px`;
  }, [tip]);

  return tip
    ? createPortal(
        <div className="app-tooltip" ref={tooltipRef} aria-hidden="true">
          {tip.text}
        </div>,
        document.fullscreenElement ?? document.body,
      )
    : null;
}
