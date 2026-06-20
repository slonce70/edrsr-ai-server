import { useEffect, useState } from 'react';
import { useLocale } from '../state/LocaleContext';

// Show the button once the user has scrolled past roughly one viewport of
// content; below this there is nothing meaningful to scroll back up to.
const SHOW_THRESHOLD = 600;

// Floating "back to top" button for the long, window-scrolled report pages.
// Appears after the user scrolls down and smoothly returns them to the top.
export function BackToTop() {
  const { t } = useLocale();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // SSR / jsdom guard.
    if (typeof window === 'undefined') return;

    let rafId = 0;
    let queued = false;

    const measure = () => {
      queued = false;
      setVisible(window.scrollY > SHOW_THRESHOLD);
    };

    // rAF-throttle so visibility toggles at most once per frame while scrolling.
    const onScroll = () => {
      if (queued) return;
      queued = true;
      rafId = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const handleClick = () => {
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  };

  return (
    <button
      type="button"
      className={`back-to-top${visible ? ' back-to-top--visible' : ''}`}
      aria-label={t('common.backToTop')}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onClick={handleClick}
    >
      <span aria-hidden="true">↑</span>
    </button>
  );
}
