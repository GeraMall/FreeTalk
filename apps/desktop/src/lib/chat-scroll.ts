export function isNearBottom(
  element: Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>,
  threshold = 130,
) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
}
