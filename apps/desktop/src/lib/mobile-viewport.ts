// iOS pans the visual viewport to a focused composer without resizing 100dvh.
// Fit the app to the visible area while the keyboard is open; scroll only the
// message list, then restore the window origin when the keyboard closes.
export function installMobileViewport(
  target: Window = window,
  document: Document = target.document,
) {
  const root = document.documentElement;
  const viewport = target.visualViewport;
  let baseline = Math.max(target.innerHeight, viewport?.height ?? 0);
  let wasOpen = false;
  let frame = 0;
  let blurTimer: ReturnType<typeof setTimeout>;
  const update = () => {
    frame = 0;
    const mobile = target.matchMedia('(max-width: 760px)').matches;
    const canvas = Boolean(document.querySelector('.mobile-account-shell'));
    const focused =
      document.activeElement instanceof Element &&
      Boolean(document.activeElement.closest('input, textarea, [contenteditable="true"]'));
    if (!focused) baseline = Math.max(target.innerHeight, viewport?.height ?? 0);
    const open =
      mobile && canvas && focused && Boolean(viewport && baseline - viewport.height > 120);
    root.classList.toggle('mobile-keyboard-open', open);
    if (open && viewport) {
      root.style.setProperty('--trlka-visible-height', `${Math.round(viewport.height)}px`);
      root.style.setProperty('--trlka-visible-top', `${Math.round(viewport.offsetTop)}px`);
    } else {
      root.style.removeProperty('--trlka-visible-height');
      root.style.removeProperty('--trlka-visible-top');
      if (mobile && canvas && (wasOpen || !focused) && (target.scrollY || target.scrollX))
        target.scrollTo(0, 0);
    }
    wasOpen = open;
  };
  const schedule = () => {
    if (!frame) frame = target.requestAnimationFrame(update);
  };
  const blur = () => {
    schedule();
    clearTimeout(blurTimer);
    blurTimer = setTimeout(schedule, 350);
  };
  target.addEventListener('resize', schedule);
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', blur);
  return () => {
    target.cancelAnimationFrame(frame);
    clearTimeout(blurTimer);
    target.removeEventListener('resize', schedule);
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    document.removeEventListener('focusin', schedule);
    document.removeEventListener('focusout', blur);
    root.classList.remove('mobile-keyboard-open');
    root.style.removeProperty('--trlka-visible-height');
    root.style.removeProperty('--trlka-visible-top');
  };
}
