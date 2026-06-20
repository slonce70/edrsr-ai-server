import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import { useLocale } from '../state/LocaleContext';
import { extractToc, pickActiveId } from '../lib/reportToc';

type ReportTocProps = {
  markdown?: string | null;
};

// Matches the `scroll-margin-top: 80px` on `.markdown h1..h4`: a heading is
// considered "current" once its top crosses this line near the top of the
// viewport, mirroring where a clicked section lands.
const ACTIVE_OFFSET = 90;

export function ReportToc({ markdown }: ReportTocProps) {
  const { t } = useLocale();
  const items = useMemo(() => extractToc(markdown), [markdown]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Scroll-spy: highlight the section currently in view.
  // We use an IntersectionObserver purely as a "something moved into/out of the
  // top band" trigger, then recompute the active id from the live heading
  // positions with the pure `pickActiveId` helper. This handles the gaps
  // between headings (no entry intersecting) cleanly: we keep the last passed
  // heading rather than blanking out.
  useEffect(() => {
    // SSR / jsdom guard: no IntersectionObserver -> skip silently, no crash.
    if (typeof IntersectionObserver === 'undefined') return;
    if (items.length < 2) return;

    let observer: IntersectionObserver | null = null;
    let rafId = 0;
    let scrollRafId = 0;
    let scrollQueued = false;
    let retries = 0;
    let scrollTarget: HTMLElement | Window | null = null;

    const recompute = () => {
      const positions = items
        .map((item) => {
          const el = document.getElementById(item.id);
          return el ? { id: item.id, top: el.getBoundingClientRect().top } : null;
        })
        .filter((entry): entry is { id: string; top: number } => entry !== null);
      setActiveId(pickActiveId(positions, ACTIVE_OFFSET));
    };

    // rAF-throttle the raw scroll handler: collapse bursts of scroll events into
    // one `recompute` per frame so we never thrash layout by calling
    // getBoundingClientRect per heading on every event. The IO callback stays
    // direct (it already coalesces); `pickActiveId` is pure so the result is
    // identical — just computed fewer times. Uses a dedicated raf id so it never
    // collides with the `setup()` heading-availability retry loop above.
    const onScroll = () => {
      if (scrollQueued) return;
      scrollQueued = true;
      scrollRafId = requestAnimationFrame(() => {
        scrollQueued = false;
        recompute();
      });
    };

    const setup = () => {
      const elements = items
        .map((item) => document.getElementById(item.id))
        .filter((el): el is HTMLElement => el !== null);

      // Headings are rendered asynchronously by MarkdownView; if they are not
      // all present yet, retry on the next animation frame (capped) until they
      // appear. Prevents observing a partial/empty set on first paint.
      if (elements.length < items.length && retries < 30) {
        retries += 1;
        rafId = requestAnimationFrame(setup);
        return;
      }
      if (elements.length === 0) return;

      // rootMargin keeps a heading "active" while it sits in the top ~30% of the
      // viewport; the callback just re-triggers our position-based recompute.
      observer = new IntersectionObserver(recompute, {
        rootMargin: '0px 0px -70% 0px',
        threshold: [0, 1],
      });
      elements.forEach((el) => observer?.observe(el));

      // Recompute on raw scroll too, so the highlight stays correct while
      // scrolling through long stretches with no observer boundary crossings.
      scrollTarget = window;
      scrollTarget.addEventListener('scroll', onScroll, { passive: true });

      // Initial paint (e.g. deep-linked hash, or report already scrolled).
      recompute();
    };

    setup();

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (scrollRafId) cancelAnimationFrame(scrollRafId);
      observer?.disconnect();
      scrollTarget?.removeEventListener('scroll', onScroll);
    };
  }, [items]);

  // A TOC for 0-1 sections is noise; render nothing.
  if (items.length < 2) return null;

  const handleClick = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav className="report-toc" aria-label={t('report.contents')}>
      <details className="report-toc__details" open>
        <summary className="report-toc__summary">{t('report.contents')}</summary>
        <ul className="report-toc__list">
          {items.map((item) => {
            const isActive = item.id === activeId;
            return (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className={`report-toc__link report-toc__link--h${item.level}${
                    isActive ? ' report-toc__link--active' : ''
                  }`}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={(event) => handleClick(event, item.id)}
                >
                  {item.text}
                </a>
              </li>
            );
          })}
        </ul>
      </details>
    </nav>
  );
}
