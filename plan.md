# План реалізації: портал користувача + розширені можливості

## Ціль
Зробити веб-портал для користувачів розширення з локалізацією, командною роботою,
“Matters”, evidence‑snippets у звіті, публічним share‑link, та експортами у TXT/PDF.

## Фази (MVP → V1 → V2)
### MVP (швидкий старт)
- [x] Локалізація (UA/RU) для логіну і сторінок.
- [x] Реєстрація/логін/відновлення пароля через Supabase magic link.
- [x] “Мої аналізи” + сторінка job (progress, report, чат).
- [x] Експорт звіту у TXT/PDF (друк з браузера).
- [x] Share‑link (token + expiry) для публічного перегляду.

### V1 (те, що реально купують фірми)
- [x] Matters: структура Matter → Jobs → links → висновки.
- [x] Evidence snippets у звіті (фрагменти тексту рішення + посилання).
- [x] Командна робота: workspace + ролі (owner/admin/member).
- [x] Бібліотека кейсів (список links з метаданими) — як частина сторінки matter.

### V2 (диференціатор)
- [ ] Моніторинг/алерти (watchlists → нові рішення → авто‑аналіз).
- [ ] Аналітика практики (тренди по статтях/судах/суддях).
- [ ] Повний експорт у DOCX (окремий сервіс/воркер).

## Реалізовано (backend)
- [x] Нові таблиці: workspaces, workspace_members, matters, share_links.
- [x] Нові колонки/індекси: jobs.workspace_id, jobs.matter_id,
      job_links.evidence_snippet, job_links.evidence_extracted_at.
- [x] Middleware для workspace‑ролей + перевірок доступу.
- [x] API для workspaces/members/matters/share‑links.
- [x] Публічний endpoint `/api/share/:token`.
- [x] Додано evidence‑snippets через `evidenceService`.

## Реалізовано (web)
- [x] i18n контекст + перемикач мови.
- [x] Auth контекст (magic link, reset password).
- [x] Сторінки: Matters list, Matter detail, Share page, Reset password.
- [x] Job detail: evidence, share, експорти.
- [x] Settings: керування командою workspace.

## Перевірки
- [x] `npm run lint`
- [x] `npm run web:lint`
- [x] `npm run format:check`

## Наступні кроки (перед деплоєм)
- [ ] Прогнати міграції БД на проді (створення таблиць/колонок).
- [ ] Перевірити `APP_BASE_URL` і `PUBLIC_SHARE_BASE_URL` у `server/.env`.
- [ ] Додати redirect URLs в Supabase:
      - `https://app.edrsr-ai-server.fun/reset`
      - `https://app.edrsr-ai-server.fun`
- [ ] Перевірити доступи до workspace після деплою (smoke test).
