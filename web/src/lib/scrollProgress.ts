// Pure helper for the reading-progress indicator. Given the current scroll
// position and document/viewport sizes, returns how far the document is
// scrolled as a 0..1 fraction. Kept side-effect free so it can be unit tested
// without a DOM; the component feeds it live `window` values.
export function computeScrollProgress(
  scrollY: number,
  scrollHeight: number,
  viewportHeight: number
): number {
  // The maximum distance the document can scroll. When the content fits the
  // viewport (or any input is non-finite/negative), there is nothing to track.
  const scrollable = scrollHeight - viewportHeight;
  if (
    !Number.isFinite(scrollY) ||
    !Number.isFinite(scrollHeight) ||
    !Number.isFinite(viewportHeight) ||
    scrollable <= 0
  ) {
    return 0;
  }
  const fraction = scrollY / scrollable;
  // Clamp out-of-range inputs (e.g. iOS rubber-band overscroll) to 0..1.
  if (fraction <= 0) return 0;
  if (fraction >= 1) return 1;
  return fraction;
}
