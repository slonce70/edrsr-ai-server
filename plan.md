# План міграції EDRSR‑AI на VPS (Supabase тільки для auth)

Дата старту: 2026-01-01

## Легенда
- [ ] не виконано
- [x] виконано

## План (30 кроків)
1. [x] Зняти інвентаризацію поточного продакшн‑стану: домен, API/WS URL, версії Node/Postgres, активні ENV у Render.
2. [x] Зчитати поточний `.env` із Render (локальний файл) та скласти перелік ключів, які потрібні на VPS (без розкриття значень).
3. [ ] Визначити коротке вікно даунтайму та стратегію cutover (DNS або IP‑перемикання), зафіксувати час.
4. [x] Підготувати VPS: оновити пакети, створити системного користувача, налаштувати firewall (22/80/443).
5. [x] Встановити Node.js 16+ і npm на VPS; перевірити `node -v`.
6. [x] Встановити PostgreSQL 12+ на VPS, створити БД `edrsr_ai` і користувача з паролем.
7. [x] Налаштувати Postgres (listen/pg_hba), часовий пояс, `max_connections` під пул.
8. [x] Підготувати `server/.env` для VPS (DATABASE_URL локальної БД; PGSSL=false; PGSSLMODE=disable; ключі Supabase/Gemini/CLI‑proxy; CORS_ALLOWED_ORIGINS).
9. [x] Налаштувати reverse‑proxy (Nginx/Caddy) з підтримкою WebSocket, HTTP→HTTPS.
10. [x] Отримати SSL‑сертифікат (Let’s Encrypt) для домену.
11. [x] Налаштувати запуск сервера через systemd/PM2 (`server/start-with-gc.js`).
12. [x] Перевірити, що keep‑alive Render вимкнено (без `RENDER_EXTERNAL_URL`).
13. [x] Зробити первинний бекап з Supabase Postgres (тільки schema public + потрібні таблиці).
14. [x] Перевірити бекап на цілісність (кількість рядків ключових таблиць).
15. [x] Відновити бекап у локальний Postgres на VPS.
16. [x] Запустити сервер на VPS у staging‑режимі (тимчасовий домен/порт), переконатися в авто‑міграціях/індексах.
17. [x] Перевірити `/admin` (статична адмінка) та логін через Supabase, наявність ролі admin у `user_roles`.
18. [x] Оновити `extension/config.js`: `API_BASE_URL`, `WS_URL`, `SUPABASE_REDIRECT_TO` під новий домен.
19. [x] Додати новий `SUPABASE_REDIRECT_TO` у Supabase Auth Redirect URLs.
20. [x] Запустити health‑перевірки: `/api/health/light` і `/api/health/full` (з адмін‑токеном).
21. [x] Smoke‑тест: створити job із розширення, перевірити записи в БД (`jobs`, `job_links`, `job_results`).
22. [x] Перевірити WebSocket прогрес/статуси та завершення job.
23. [x] Перевірити адмін‑операції: users list (Supabase Admin API), requeue/retry, cleanup.
24. [ ] Перевірити обмеження по памʼяті/CPU і, за потреби, зменшити `BATCH_SIZE`, `MAX_CONCURRENT_BATCHES`, `MAX_CONCURRENT_REQUESTS`.
25. [x] Налаштувати регулярні бекапи локальної БД (cron + `pg_dump`) та перевірити restore.
26. [ ] Підготувати план відкату (DNS назад/старий бекенд, збереження Render env).
27. [x] Провести фінальний бекап перед cutover (щоб не втратити нові дані).
28. [ ] Виконати cutover: оновити домен/URL, перезапустити сервер, перевірити логін/джоби.
29. [x] Пост‑моніторинг 24–48 год: логи, памʼять, черга, помилки авторизації.
30. [x] Оновити документацію в `docs/` (новий продакшн‑процес, відновлення, контакти).

## Фінальний cutover‑чеклист
- [x] DNS A‑записи для `edrsr-ai-server.fun` та `www` вказують на `5.252.118.213`.
- [x] SSL (Let’s Encrypt) встановлено, HTTP → HTTPS редірект.
- [x] Nginx проксі під `edrsr-ai-server.fun` з WebSocket.
- [x] Оновлено `CORS_ALLOWED_ORIGINS` та `WS_ALLOWED_ORIGINS` під домен.
- [x] Оновлено `extension/config.js` під `https/wss`, збірка розширення зроблена.
- [x] Supabase Redirect URLs доповнені доменом.
- [x] Фінальний pre‑cutover бекап (перед вимкненням старого прода).
- [ ] Реліз/оновлення розширення для користувачів (Chrome Web Store або manual).
- [ ] Оновити/сповістити команду про cutover і точний час.

## Smoke‑тест (через новий домен)
- [x] `GET https://edrsr-ai-server.fun/api/health/light` → 200.
- [x] `GET https://edrsr-ai-server.fun/api/health/full` (admin token) → 200, status=healthy.
- [x] Admin API: `/api/admin/dashboard`, `/api/admin/system/stats`, `/api/admin/users`, `/api/admin/jobs`, `/api/admin/audit-log` → 200.
- [x] WebSocket `wss://edrsr-ai-server.fun` → отримано `clientId`.
- [x] Адмінка: `GET /admin/` та `GET /admin/report.html` → 200.

## Пост‑моніторинг (24–48 год)
- [x] Перевірити логи сервісу: `journalctl -u edrsr-ai -n 200 --no-pager`.
- [x] Перевірити памʼять/CPU (`top`/`htop`), за потреби підкрутити batch‑налаштування.
- [ ] Перевірити чергу/завислі воркери, виконати cleanup при потребі.
- [x] Перевірити стабільність WS (підключення + оновлення статусів).
- [x] Перевірити помилки авторизації та rate‑limit в логах.
- [ ] Переконатися, що бекапи створюються і доступні для відновлення.

## Go/No‑Go чеклист (перед відключенням старого Render)
- [x] Домен `edrsr-ai-server.fun` резолвиться на `5.252.118.213`.
- [x] HTTPS відповідає 200 для `/api/health/light`.
- [x] Admin API через домен працює (dashboard/users/jobs/audit).
- [x] WebSocket через `wss://edrsr-ai-server.fun` приймає підключення.
- [x] Supabase Redirect URLs оновлені.
- [x] Фінальний бекап перед cutover зроблено.
- [ ] Розширення оновлене у користувачів (або опублікований новий реліз).
- [ ] Повідомлено команду про момент відключення старого бекенду.

---

# План безпеки та покращення адмін‑панелі (2026‑01‑01)

## Легенда
- [ ] не виконано
- [x] виконано

## План (24 кроки)
1. [x] Інвентаризувати адмін‑поверхню та залежності (`server/routes/admin.js`, `server/middleware/*`, `server/public/admin/*`, `docs/*`).
2. [x] Зафіксувати threat‑model адмінки (XSS/CSRF, role escalation, data‑leak, mass‑ops, rate‑limit, audit‑trail).
3. [x] Перевірити всі `innerHTML`/динамічні вставки в UI та скласти список XSS‑ризиків.
4. [x] Усунути XSS у звіті: безпечний markdown‑renderer (без HTML), sanitize link/image.
5. [x] Перевести `marked` на локальний файл (без CDN).
6. [x] Перевести Font Awesome на локальні файли (без CDN).
7. [x] Прибрати inline‑handlers (`onclick`) у `index.html`, перенести в `script.js`.
8. [x] Посилити CSP для `/admin` (без `unsafe-inline` для script, без CDN).
9. [x] Екранувати/санітизувати audit/security блоки в адмін‑UI.
10. [x] Оновити metadata/HTML у `report.js` з повним escape для полів job.
11. [x] Перейти з `localStorage` на `sessionStorage` для адмін‑токена (м’яка міграція).
12. [x] Додати idle‑timeout (30 хв) + авто‑logout за неактивності.
13. [x] Додати step‑up підтвердження для критичних дій (cleanup/delete/retry‑all).
14. [x] Вирівняти повідомлення помилок (без витоку деталей).
15. [x] Додати `Permissions-Policy` та інші базові security‑headers.
16. [x] Перевірити rate‑limit для адмін‑роутів та login (значення/повідомлення).
17. [x] UX‑полірування: візуальні стани, пусті таблиці, завантаження.
18. [x] Перевірити доступність (контраст, фокус, aria‑labels, keyboard).
19. [x] Оновити `docs/ADMIN_SETUP.md` з новими правилами (CSP/сесії).
20. [x] Оновити `docs/SECURITY_AUDIT_REPORT.md` (новий аудит/зміни).
21. [x] Smoke‑тест адмінки: login, dashboard, users, jobs, audit, system.
22. [x] XSS‑тести: вставка HTML у title/analysis/log‑fields.
23. [x] Перевірка CSP у браузері (blocked resources/errors).
24. [x] Підготувати short rollback‑notes.
