# Portal Phase 0 — Trust Signals & Crash Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the user portal stop presenting incomplete/failed legal analyses as complete — surface a quality/completeness banner, show the failure reason with a one-click re-run, and stop a single render error from white-screening the whole app.

**Architecture:** Frontend-only, additive. A pure function reads the markers the backend's quality footer already emits (`server/qualityControl.js`, `server/batchProcessor.js`) and classifies a report as `ok` or `partial`. A presentational banner renders that classification on `JobDetailPage` and the public `SharePage`. The failed-job card renders the already-typed `error_message` plus a Retry button wired to the existing `POST /api/retry/:jobId`. A root React error boundary wraps the app. A Vitest test stack is introduced first so every behavior is TDD'd.

**Tech Stack:** React 19, TypeScript ~5.9, Vite 7, react-router-dom 6, Vitest + @testing-library/react + jsdom (added in Task 1). Markdown is already `marked` + `dompurify` (sanitized — no change).

## Global Constraints

- **Pipeline is OUT OF SCOPE.** Do not modify `server/worker.js`, `server/gemini.js`, `server/batchProcessor.js`, `server/parallelBatchProcessor.js`, or `server/qualityControl.js`. This plan only reads the text those files already produce.
- **All work happens in `web/`.** Run every command from the `web/` directory unless a path says otherwise.
- **Quality-marker rule (verified):** classify "partial" ONLY off failure-specific markers — `Частина справ не була проаналізована`, `Виявлені проблеми`, or a `Покриття даних … NN%` value below 100. **NEVER** key off `ЗВІТ КОНТРОЛЮ ЯКОСТІ` — it is emitted on every report (`server/qualityControl.js:84`) and would warn 100% of the time.
- **TDD:** no production code without a failing test first (except the Vitest config/scaffolding in Task 1 and CSS).
- **TypeScript strict** is on (`noUnusedLocals`/`noUnusedParameters`). No unused symbols.
- **i18n:** every user-facing string goes through `t('...')` with keys added to BOTH `uk` and `ru` blocks in `web/src/i18n/strings.ts`. Interpolation uses `{{param}}`.
- **Commit after every task** with the shown message.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `web/package.json` | add test deps + `test` scripts | Modify |
| `web/vitest.config.ts` | Vitest jsdom config | Create |
| `web/src/test/setup.ts` | jest-dom matchers | Create |
| `web/src/test/smoke.test.ts` | proves the runner works | Create (Task 1) |
| `web/src/lib/analysisQuality.ts` | pure report-quality classifier (C1 core) | Create |
| `web/src/lib/analysisQuality.test.ts` | classifier tests | Create |
| `web/src/components/ReportStatusBanner.tsx` | renders the partial/incomplete warning | Create |
| `web/src/components/ReportStatusBanner.test.tsx` | banner tests | Create |
| `web/src/components/ErrorBoundary.tsx` | root crash fallback | Create |
| `web/src/components/ErrorBoundary.test.tsx` | boundary tests | Create |
| `web/src/i18n/strings.ts` | new `job.quality.*`, `job.retry`, `job.errorReasonTitle` keys (uk + ru) | Modify |
| `web/src/index.css` | `.report-banner` + `.job-error` styles | Modify |
| `web/src/pages/JobDetailPage.tsx` | render banner + error_message + Retry | Modify |
| `web/src/pages/SharePage.tsx` | render banner on public view | Modify |
| `web/src/main.tsx` | wrap `<App/>` in `<ErrorBoundary>` | Modify |

---

## Task 1: Test infrastructure (Vitest + Testing Library)

**Files:**
- Modify: `web/package.json`
- Create: `web/vitest.config.ts`
- Create: `web/src/test/setup.ts`
- Create: `web/src/test/smoke.test.ts`

**Interfaces:**
- Produces: `npm test` (alias `vitest run`) runs the suite under jsdom with `@testing-library/jest-dom` matchers and `globals: true` (so `describe/it/expect` need no import).

- [ ] **Step 1: Install dev dependencies**

Run (from `web/`):
```bash
npm install -D vitest@^3 jsdom@^25 @testing-library/react@^16 @testing-library/jest-dom@^6 @testing-library/user-event@^14
```
Expected: installs without peer-dependency errors (React 19 is supported by @testing-library/react 16).

- [ ] **Step 2: Create the Vitest config**

Create `web/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: false,
  },
});
```

- [ ] **Step 3: Create the test setup file**

Create `web/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: Add test scripts to package.json**

In `web/package.json`, change the `"scripts"` block to:
```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- [ ] **Step 5: Write a smoke test**

Create `web/src/test/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('test runner', () => {
  it('runs and asserts', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run it and verify it passes**

Run (from `web/`): `npm test`
Expected: PASS — `1 passed` (1 test). No config errors.

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/package-lock.json web/vitest.config.ts web/src/test/setup.ts web/src/test/smoke.test.ts
git commit -m "test(web): add Vitest + Testing Library test stack"
```

---

## Task 2: `analyzeReportQuality()` classifier (C1 core)

**Files:**
- Create: `web/src/lib/analysisQuality.ts`
- Create: `web/src/lib/analysisQuality.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type AnalysisQualityLevel = 'ok' | 'partial';
  export type AnalysisQuality = { level: AnalysisQualityLevel; coverage: number | null };
  export function analyzeReportQuality(markdown: string | null | undefined): AnalysisQuality;
  ```
  `coverage` is the parsed `Покриття даних` percentage when present (else `null`). `level` is `'partial'` when a failure marker is present or coverage < 100, else `'ok'`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/analysisQuality.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { analyzeReportQuality } from './analysisQuality';

describe('analyzeReportQuality', () => {
  it('treats null/empty as ok', () => {
    expect(analyzeReportQuality(null)).toEqual({ level: 'ok', coverage: null });
    expect(analyzeReportQuality('')).toEqual({ level: 'ok', coverage: null });
  });

  it('treats a clean 100% report as ok (and ignores the ЗВІТ КОНТРОЛЮ ЯКОСТІ header)', () => {
    const report =
      '# Аналіз\n...body...\n\n📋 **ЗВІТ КОНТРОЛЮ ЯКОСТІ:**\n' +
      '• **Покриття даних:** 100%\n• **Повнота обробки:** Підтверджено\n' +
      '### 🎯 Висновок\n✅ Отличное качество! Все дела обработаны корректно.';
    expect(analyzeReportQuality(report)).toEqual({ level: 'ok', coverage: 100 });
  });

  it('flags partial when a batch was skipped', () => {
    const report = 'тіло\n⚠️ Частина справ не була проаналізована через тимчасову помилку AI.';
    expect(analyzeReportQuality(report).level).toBe('partial');
  });

  it('flags partial when QC reports problems', () => {
    const report = '...\n• **Повнота обробки:** Виявлені проблеми\n### ⚠️ Виявлені проблеми\n• ...';
    expect(analyzeReportQuality(report).level).toBe('partial');
  });

  it('flags partial and parses coverage when below 100%', () => {
    const report = '...\n• **Покриття даних:** 78%\n...';
    expect(analyzeReportQuality(report)).toEqual({ level: 'partial', coverage: 78 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `web/`): `npx vitest run src/lib/analysisQuality.test.ts`
Expected: FAIL — `Failed to resolve import "./analysisQuality"` / `analyzeReportQuality is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Create `web/src/lib/analysisQuality.ts`:
```ts
export type AnalysisQualityLevel = 'ok' | 'partial';
export type AnalysisQuality = { level: AnalysisQualityLevel; coverage: number | null };

// Markers emitted by the backend quality footer / fallback summaries.
// NOTE: do NOT use 'ЗВІТ КОНТРОЛЮ ЯКОСТІ' — it appears on EVERY report.
const SKIPPED_BATCH = 'Частина справ не була проаналізована';
const QC_PROBLEMS = 'Виявлені проблеми';
const COVERAGE_RE = /Покриття даних[^\d]{0,12}(\d{1,3})\s*%/;

export function analyzeReportQuality(markdown: string | null | undefined): AnalysisQuality {
  const text = markdown || '';
  let coverage: number | null = null;

  const match = text.match(COVERAGE_RE);
  if (match) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) coverage = parsed;
  }

  const hasFailureMarker = text.includes(SKIPPED_BATCH) || text.includes(QC_PROBLEMS);
  const coverageBelow100 = coverage !== null && coverage < 100;

  return {
    level: hasFailureMarker || coverageBelow100 ? 'partial' : 'ok',
    coverage,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `web/`): `npx vitest run src/lib/analysisQuality.test.ts`
Expected: PASS — `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/analysisQuality.ts web/src/lib/analysisQuality.test.ts
git commit -m "feat(web): add analyzeReportQuality classifier for incomplete reports"
```

---

## Task 3: i18n strings + banner/error styles

**Files:**
- Modify: `web/src/i18n/strings.ts` (the `uk.job` block near line 152 and the `ru.job` block near line 452)
- Modify: `web/src/index.css`

**Interfaces:**
- Produces translation keys consumed by Tasks 4–5: `job.quality.partialTitle`, `job.quality.partialBody`, `job.quality.coverage` (param `{{coverage}}`), `job.errorReasonTitle`, `job.retry`, `job.retrying`. CSS classes `report-banner report-banner--warning` and `job-error`.

- [ ] **Step 1: Add keys to the Ukrainian `job` block**

In `web/src/i18n/strings.ts`, inside `translations.uk.job` (the object opening at the `job: {` near line 152), add these members (place after the existing `reportEmpty` line):
```ts
      quality: {
        partialTitle: '⚠️ Звіт неповний',
        partialBody:
          'Аналіз охопив не всі справи або був обірваний моделлю. Перевірте охоплення перед використанням.',
        coverage: 'Охоплення: {{coverage}}%',
      },
      errorReasonTitle: 'Помилка аналізу',
      retry: 'Повторити аналіз',
      retrying: 'Запуск повтору...',
```

- [ ] **Step 2: Add the same keys to the Russian `job` block**

In `web/src/i18n/strings.ts`, inside `translations.ru.job` (the `job: {` near line 452), add (after `reportEmpty`):
```ts
      quality: {
        partialTitle: '⚠️ Отчёт неполный',
        partialBody:
          'Анализ охватил не все дела или был оборван моделью. Проверьте охват перед использованием.',
        coverage: 'Охват: {{coverage}}%',
      },
      errorReasonTitle: 'Ошибка анализа',
      retry: 'Повторить анализ',
      retrying: 'Запуск повтора...',
```

- [ ] **Step 3: Add styles**

Append to `web/src/index.css`:
```css
.report-banner {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 16px;
  border-radius: 10px;
  margin-bottom: 16px;
  border: 1px solid transparent;
}
.report-banner--warning {
  background: #fef3c7;
  border-color: #f59e0b;
  color: #7c2d12;
}
.report-banner strong {
  font-weight: 600;
}
.job-error {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.job-error__message {
  white-space: pre-wrap;
}
```

- [ ] **Step 4: Verify the app still type-checks**

Run (from `web/`): `npm run build`
Expected: PASS — `tsc -b` reports no errors and Vite build completes.

- [ ] **Step 5: Commit**

```bash
git add web/src/i18n/strings.ts web/src/index.css
git commit -m "feat(web): add i18n strings and styles for report quality + retry"
```

---

## Task 4: `ReportStatusBanner` component

**Files:**
- Create: `web/src/components/ReportStatusBanner.tsx`
- Create: `web/src/components/ReportStatusBanner.test.tsx`

**Interfaces:**
- Consumes: `analyzeReportQuality` (Task 2), `useLocale` (`web/src/state/LocaleContext.tsx`), `job.quality.*` strings (Task 3).
- Produces: `export function ReportStatusBanner({ markdown }: { markdown?: string | null }): JSX.Element | null`. Returns `null` for `ok`, an `role="alert"` warning otherwise.

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/ReportStatusBanner.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocaleProvider } from '../state/LocaleContext';
import { ReportStatusBanner } from './ReportStatusBanner';

function renderBanner(markdown: string | null) {
  return render(
    <LocaleProvider>
      <ReportStatusBanner markdown={markdown} />
    </LocaleProvider>
  );
}

describe('ReportStatusBanner', () => {
  it('renders nothing for a clean report', () => {
    const { container } = renderBanner('• **Покриття даних:** 100%');
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an alert for a partial report', () => {
    renderBanner('⚠️ Частина справ не була проаналізована через тимчасову помилку AI.');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Звіт неповний/)).toBeInTheDocument();
  });

  it('shows coverage when present', () => {
    renderBanner('• **Покриття даних:** 78%');
    expect(screen.getByText(/78%/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `web/`): `npx vitest run src/components/ReportStatusBanner.test.tsx`
Expected: FAIL — cannot resolve `./ReportStatusBanner`.

- [ ] **Step 3: Write the component**

Create `web/src/components/ReportStatusBanner.tsx`:
```tsx
import { analyzeReportQuality } from '../lib/analysisQuality';
import { useLocale } from '../state/LocaleContext';

type ReportStatusBannerProps = {
  markdown?: string | null;
};

export function ReportStatusBanner({ markdown }: ReportStatusBannerProps) {
  const { t } = useLocale();
  const quality = analyzeReportQuality(markdown);

  if (quality.level === 'ok') return null;

  const coverageText =
    quality.coverage !== null ? t('job.quality.coverage', { coverage: quality.coverage }) : '';

  return (
    <div className="report-banner report-banner--warning" role="alert">
      <strong>{t('job.quality.partialTitle')}</strong>
      <span>
        {t('job.quality.partialBody')}
        {coverageText ? ` ${coverageText}` : ''}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `web/`): `npx vitest run src/components/ReportStatusBanner.test.tsx`
Expected: PASS — `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ReportStatusBanner.tsx web/src/components/ReportStatusBanner.test.tsx
git commit -m "feat(web): add ReportStatusBanner for incomplete analyses"
```

---

## Task 5: Wire banner + error_message + Retry into `JobDetailPage`

**Files:**
- Modify: `web/src/pages/JobDetailPage.tsx`

**Interfaces:**
- Consumes: `ReportStatusBanner` (Task 4), `useWebSocket().clientId` (`web/src/state/WebSocketContext.tsx:17`), existing `apiRequest`, `job.errorReasonTitle`/`job.retry`/`job.retrying` (Task 3), existing endpoint `POST /api/retry/:jobId` (`server/routes/job-mutations.js:23`, requires body `{ clientId }`).

- [ ] **Step 1: Write the failing test**

Create `web/src/pages/JobDetailPage.retry.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { buildRetryBody } from './jobRetry';

describe('buildRetryBody', () => {
  it('includes the websocket clientId', () => {
    expect(buildRetryBody('abc-123')).toEqual({ clientId: 'abc-123' });
  });
  it('throws when there is no clientId yet', () => {
    expect(() => buildRetryBody(null)).toThrow();
  });
});
```

(We extract the retry body builder into a tiny pure module so it is unit-testable without mounting the page.)

- [ ] **Step 2: Run it to verify it fails**

Run (from `web/`): `npx vitest run src/pages/JobDetailPage.retry.test.tsx`
Expected: FAIL — cannot resolve `./jobRetry`.

- [ ] **Step 3: Create the helper**

Create `web/src/pages/jobRetry.ts`:
```ts
export function buildRetryBody(clientId: string | null): { clientId: string } {
  if (!clientId) {
    throw new Error('Realtime connection not ready — retry is unavailable.');
  }
  return { clientId };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run (from `web/`): `npx vitest run src/pages/JobDetailPage.retry.test.tsx`
Expected: PASS — `2 passed`.

- [ ] **Step 5: Add imports to `JobDetailPage.tsx`**

In `web/src/pages/JobDetailPage.tsx`, add to the component imports (after the existing `MarkdownView` import on line 13):
```tsx
import { ReportStatusBanner } from '../components/ReportStatusBanner';
import { buildRetryBody } from './jobRetry';
```

- [ ] **Step 6: Pull `clientId` from the WebSocket context and add retry state**

In `JobDetailPage.tsx`, change the `useWebSocket()` destructure (line 72) to also take `clientId`:
```tsx
  const { subscribe, onJobUpdate, clientId } = useWebSocket();
```
Then add a state flag next to the other `useState` calls (e.g. after `const [deleting, setDeleting] = useState(false);` on line 89):
```tsx
  const [retrying, setRetrying] = useState(false);
```

- [ ] **Step 7: Add the retry handler**

In `JobDetailPage.tsx`, add this handler next to `handleDeleteJob` (after its closing brace, around line 352):
```tsx
  const handleRetry = async () => {
    if (!accessToken || !jobId) return;
    setError(null);
    setRetrying(true);
    try {
      await apiRequest(`/retry/${jobId}`, {
        token: accessToken,
        method: 'POST',
        body: buildRetryBody(clientId),
        workspaceId: activeWorkspaceId || undefined,
      });
      navigate('/analyses');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'));
    } finally {
      setRetrying(false);
    }
  };
```

- [ ] **Step 8: Render the error reason + Retry button**

In `JobDetailPage.tsx`, inside the status card body, immediately after the `<div className="stats">...</div>` block closes (after line 425) and before the card body's closing `</div>` (line 426), insert:
```tsx
            {job.status === 'error' && job.error_message ? (
              <div className="card--error job-error">
                <strong>{t('job.errorReasonTitle')}</strong>
                <div className="job-error__message">{job.error_message}</div>
                <button
                  className="btn btn-primary"
                  onClick={handleRetry}
                  disabled={retrying || !clientId}
                >
                  {retrying ? t('job.retrying') : t('job.retry')}
                </button>
              </div>
            ) : null}
```

- [ ] **Step 9: Render the quality banner above the report**

In `JobDetailPage.tsx`, in the report card body (the block at line 482 `<div className="card__body">` that contains the `analysis ? <MarkdownView .../>` ternary), insert the banner as the first child of that `card__body`, before the `{analysis ? (` line (483):
```tsx
          <ReportStatusBanner markdown={analysis} />
```

- [ ] **Step 10: Verify build + full test suite**

Run (from `web/`): `npm run build && npm test`
Expected: PASS — `tsc -b` clean, Vite build OK, all tests pass.

- [ ] **Step 11: Manual smoke (real backend, optional but recommended)**

Open a previously-failed job (status `error`) in the running portal: confirm the failure reason text and a working "Повторити аналіз" button appear; open a known-incomplete report: confirm the amber banner shows above it.

- [ ] **Step 12: Commit**

```bash
git add web/src/pages/JobDetailPage.tsx web/src/pages/jobRetry.ts web/src/pages/JobDetailPage.retry.test.tsx
git commit -m "feat(web): surface report quality, error reason, and retry on job detail"
```

---

## Task 6: Render the banner on the public `SharePage`

**Files:**
- Modify: `web/src/pages/SharePage.tsx`

**Interfaces:**
- Consumes: `ReportStatusBanner` (Task 4).

- [ ] **Step 1: Add the import**

In `web/src/pages/SharePage.tsx`, after the `MarkdownView` import (line 6), add:
```tsx
import { ReportStatusBanner } from '../components/ReportStatusBanner';
```

- [ ] **Step 2: Render the banner above the shared report**

In `SharePage.tsx`, inside the report `card__body` (line 65), insert the banner as its first child, before the `{data.analysis ? (` line (66):
```tsx
          <ReportStatusBanner markdown={data.analysis} />
```

- [ ] **Step 3: Verify build**

Run (from `web/`): `npm run build`
Expected: PASS — no type errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/SharePage.tsx
git commit -m "feat(web): show incomplete-report warning on public share view"
```

---

## Task 7: Root error boundary

**Files:**
- Create: `web/src/components/ErrorBoundary.tsx`
- Create: `web/src/components/ErrorBoundary.test.tsx`
- Modify: `web/src/main.tsx`

**Interfaces:**
- Produces: `export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }>`. On a child render throw it shows a static fallback with a "reload" button (a crash fallback cannot use the `useLocale` hook because it is a class component; static text is acceptable here).

- [ ] **Step 1: Write the failing test**

Create `web/src/components/ErrorBoundary.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): never {
  throw new Error('kaboom');
}

afterEach(() => vi.restoreAllMocks());

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>safe child</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('safe child')).toBeInTheDocument();
  });

  it('renders the fallback when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByRole('button', { name: /reload|перезавантажити/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `web/`): `npx vitest run src/components/ErrorBoundary.test.tsx`
Expected: FAIL — cannot resolve `./ErrorBoundary`.

- [ ] **Step 3: Write the component**

Create `web/src/components/ErrorBoundary.tsx`:
```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="center" role="alert">
          <h1>Щось пішло не так / Что-то пошло не так</h1>
          <p>Сторінку не вдалося відобразити. Спробуйте перезавантажити.</p>
          <button className="btn btn-primary" onClick={this.handleReload}>
            Перезавантажити
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run (from `web/`): `npx vitest run src/components/ErrorBoundary.test.tsx`
Expected: PASS — `2 passed`.

- [ ] **Step 5: Wrap the app**

In `web/src/main.tsx`, add the import after line 4 (`import App from './App';`):
```tsx
import { ErrorBoundary } from './components/ErrorBoundary';
```
Then wrap the provider tree: change the render so `<ErrorBoundary>` is the outermost child of `<StrictMode>`:
```tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <LocaleProvider>
        <AuthProvider>
          <WorkspaceProvider>
            <WebSocketProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </WebSocketProvider>
          </WorkspaceProvider>
        </AuthProvider>
      </LocaleProvider>
    </ErrorBoundary>
  </StrictMode>
);
```

- [ ] **Step 6: Verify build + full suite**

Run (from `web/`): `npm run build && npm test`
Expected: PASS — clean build, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/ErrorBoundary.tsx web/src/components/ErrorBoundary.test.tsx web/src/main.tsx
git commit -m "feat(web): add root error boundary so a render crash no longer white-screens the app"
```

---

## Definition of Done (Phase 0 portal)

- `npm test` and `npm run build` are green from `web/`.
- A known-incomplete analysis (one whose footer says `Виявлені проблеми` / `Частина справ не була проаналізована` / coverage < 100%) shows an amber warning banner above the report on both `JobDetailPage` and `SharePage`; a clean 100% report shows no banner.
- A failed job (`status: error`) shows its `error_message` and a working "Повторити аналіз" button that re-queues via `POST /api/retry/:jobId` and navigates to `/analyses`.
- A render-time throw shows the reload fallback instead of a blank page.
- No file under `server/worker.js`, `server/gemini.js`, `server/batchProcessor.js`, `server/parallelBatchProcessor.js`, `server/qualityControl.js` was modified (`git diff --name-only` confirms).

---

## Out of scope / explicit follow-ups (separate plans)

These were in the audit's "Phase 0" but are split out because they are a different subsystem or have an unresolved dependency. Each gets its own plan:

1. **C2 — Admin token hardening** (`server/public/admin/script.js:93-115`, `report.js:39-46`): stop mirroring the admin JWT into `localStorage`; use `sessionStorage`-only (or an httpOnly cookie). Different subsystem (vanilla JS, no test runner) — belongs in the **admin modernization** plan (audit Phase 5) or a dedicated security micro-plan, because it needs its own ES-module extraction to be testable.
2. **`error_message` on reload:** this plan renders `job.error_message` whenever the API returns it. Confirm `GET /api/status/:id` (`server/routes/job-queries.js:55`) actually includes `error_message` in its payload; if not, add it to that read-path response (tiny, additive, no pipeline change). Track in the **Phase 2 backend quality-contract** plan, which already touches `/status/:id`.
3. **Retry → open the new job:** this plan navigates to `/analyses` after retry. Once `POST /api/retry/:jobId`'s exact response field for the new job id is confirmed, navigate straight to `/analyses/:newJobId`. Cheap refinement, fold into Phase 1.

---

## Self-Review

- **Spec coverage:** C1 banner → Tasks 2–6; `error_message` render → Task 5; Retry → Task 5; root ErrorBoundary → Task 7; test stack (prerequisite for TDD) → Task 1. C2 is explicitly deferred with rationale. ✅
- **Placeholder scan:** every code step contains complete, runnable code; every test step shows the assertion and the exact `vitest` command with expected output. No "TBD"/"handle errors appropriately". ✅
- **Type consistency:** `analyzeReportQuality` returns `{ level, coverage }` in Task 2 and is consumed with those exact fields in Task 4; `buildRetryBody(clientId)` defined in Task 5 Step 3 and used in Step 7; `ReportStatusBanner({ markdown })` prop name is identical in Tasks 4, 5, 6; i18n keys added in Task 3 match those read in Tasks 4–5. ✅
