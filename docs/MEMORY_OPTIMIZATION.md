# Оптимізація пам'яті сервера EDRSR-AI

**Дата:** 1 січня 2026
**Платформа:** VPS (2GB RAM)

---

## Поточні налаштування (VPS профіль)

| Змінна | Значення | Коментар |
|---|---|---|
| `BATCH_SIZE` | `10` | Розмір batch для завантаження та AI‑аналізу |
| `MAX_CONCURRENT_BATCHES` | `7` | Паралельні AI‑батчі (рекомендовано: `min(keys, 7)`) |
| `MEMORY_WARNING_MB` | `700` | Поріг для попереджень та GC |
| `MAX_MEMORY_MB` | `1200` | Ліміт пам'яті перед жорстким перериванням |
| `CRITICAL_MEMORY_MB` | `1400` | Критичний ліміт пам'яті |
| `MEMORY_LIMIT_MB` | `1200` | Поріг для скрейпера/тестів |
| `MAX_OLD_SPACE_MB` | `1200` | Heap cap для `start:gc` |

---

## Ключові оптимізації, які вже працюють

1. **Контроль розміру batch**
   - `BATCH_SIZE=10` знижує пікове навантаження на heap.

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
BATCH_SIZE=10
MAX_CONCURRENT_BATCHES=7
MEMORY_WARNING_MB=700
MAX_MEMORY_MB=1200
CRITICAL_MEMORY_MB=1400
MAX_OLD_SPACE_MB=1200
```

> Примітка: якщо ключів Gemini менше — знижуйте `MAX_CONCURRENT_BATCHES`.

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
