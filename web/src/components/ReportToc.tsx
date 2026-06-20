import { useMemo } from 'react';
import type { MouseEvent } from 'react';
import { useLocale } from '../state/LocaleContext';
import { extractToc } from '../lib/reportToc';

type ReportTocProps = {
  markdown?: string | null;
};

export function ReportToc({ markdown }: ReportTocProps) {
  const { t } = useLocale();
  const items = useMemo(() => extractToc(markdown), [markdown]);

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
          {items.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className={`report-toc__link report-toc__link--h${item.level}`}
                onClick={(event) => handleClick(event, item.id)}
              >
                {item.text}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );
}
