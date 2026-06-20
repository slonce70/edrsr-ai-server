import { useEffect, useState } from 'react';
import { useLocale } from '../state/LocaleContext';
import { computeScrollProgress } from '../lib/scrollProgress';

// A thin fixed bar pinned to the top of the viewport whose width tracks how far
// the window is scrolled through the document. Window-scrolled report pages only
// (JobDetailPage / SharePage); self-hides on short, non-scrollable pages.
export function ReadingProgress() {
  const { t } = useLocale();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // SSR / jsdom guard: without a window the scroll effect simply never runs.
    if (typeof window === 'undefined') return;

    let rafId = 0;
    let queued = false;

    const measure = () => {
      queued = false;
      const doc = document.documentElement;
      setProgress(
        computeScrollProgress(window.scrollY, doc.scrollHeight, window.innerHeight)
      );
    };

    // rAF-throttle: collapse bursts of scroll/resize events into one read per
    // frame so we never thrash layout by measuring on every event.
    const onChange = () => {
      if (queued) return;
      queued = true;
      rafId = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onChange, { passive: true });
    window.addEventListener('resize', onChange, { passive: true });

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onChange);
      window.removeEventListener('resize', onChange);
    };
  }, []);

  // Hide entirely on non-scrollable pages so it never shows as a stray line.
  if (progress <= 0) return null;

  const percent = Math.round(progress * 100);

  return (
    <div
      className="reading-progress"
      role="progressbar"
      aria-label={t('common.readingProgress')}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{ width: `${percent}%` }}
    />
  );
}
