# Оптимізація пам'яті сервера EDRSR-AI

**Дата:** 1 січня 2026
**Платформа:** VPS (2GB RAM)

---

## Поточні налаштування (VPS профіль)

| Змінна | Значення | Коментар |
|---|---|---|
| `DOWNLOAD_BATCH_SIZE` | `10` | Розмір batch для завантаження/парсингу |
| `AI_BATCH_SIZE` | `5` | Розмір AI batch для production VPS |
| `BATCH_SIZE` | `10` | Legacy fallback, якщо окремі batch vars не задані |
| `MAX_CONCURRENT_BATCHES` | `1` | Паралельні AI‑батчі; тримати 1, доки live batch-probe не підтвердить запас quota |
| `MEMORY_WARNING_MB` | `200` | Поріг для попереджень та GC |
| `MAX_MEMORY_MB` | `400` | Ліміт пам'яті перед жорстким перериванням |
| `CRITICAL_MEMORY_MB` | `420` | Критичний ліміт пам'яті |
| `MEMORY_LIMIT_MB` | `500` | Поріг для скрейпера/тестів |
| `MAX_OLD_SPACE_MB` | `1200` | Heap cap для `start:gc` |

---

## Ключові оптимізації, які вже працюють

1. **Контроль розміру batch**
   - `DOWNLOAD_BATCH_SIZE=10` тримає парсинг передбачуваним.
   - `AI_BATCH_SIZE=5` знижує пікове навантаження і тиск на Gemini quota.

2. **Паралельність AI‑батчів**
   - `MAX_CONCURRENT_BATCHES` обмежує одночасні AI‑запити.

3. **GC‑пороги та memory guards**
   - `MEMORY_WARNING_MB` → ранній GC.
   - `MAX_MEMORY_MB` / `CRITICAL_MEMORY_MB` → жорстке припинення при перевищенні.

4. **Очищення memory‑структур**
   - `pendingAcks` в worker має TTL та автоочищення.
   - `activeWorkers` чиститься таймером у `routes/index.js`.

5. **Профілактичний GC у scraper**
   - Після кожних N справ запускається GC (за потреби).

---

## Рекомендований профіль для VPS (2GB)

```env
DOWNLOAD_BATCH_SIZE=10
AI_BATCH_SIZE=5
BATCH_SIZE=10
MAX_CONCURRENT_BATCHES=1
MEMORY_WARNING_MB=200
MAX_MEMORY_MB=400
CRITICAL_MEMORY_MB=420
MEMORY_LIMIT_MB=500
MAX_OLD_SPACE_MB=1200
```

> Примітка: збільшуйте `AI_BATCH_SIZE` або `MAX_CONCURRENT_BATCHES` тільки після live batch-probe на поточному quota profile.

---

## Моніторинг

Очікувані логи:

```
📊 [MEMORY] Heap: XXXmb / RSS: XXXmb
🗑️ [MEMORY] Профілактичний GC при XXXmb > 200mb
🗑️ [MEMORY] Після GC: XXXmb
⚠️ [MEMORY] Критичний рівень пам'яті (XXXmb)
[CLEANUP] Видаляю завислий воркер XXX
```

---

## Змінені файли (актуально)

- `server/worker.js`
- `server/parallelBatchProcessor.js`
- `server/routes/index.js`
- `server/scraper.js`
- `server/env.example`
