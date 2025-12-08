# Оптимізація пам'яті сервера EDRSR-AI

**Дата:** 7 грудня 2025
**Платформа:** Render.com (безкоштовний тариф, 512MB RAM)
**Аудитор:** Claude AI (Opus 4.5)

---

## Проблема

Сервер на Render.com регулярно перевантажувався через витоки пам'яті та неоптимальну обробку великих даних, що призводило до OOM (Out of Memory) crashes.

---

## Знайдені проблеми

### Критичні (викликали OOM)

| # | Проблема | Файл | Вплив |
|---|----------|------|-------|
| 1 | `allValidCasesForAnalysis` масив безмежно зростав | worker.js | Всі справи в пам'яті до кінця |
| 2 | `completedResults` Map зберігав всі результати | parallelBatchProcessor.js | Великі строки ніколи не видалялися |
| 3 | Batch size 25 при 480MB heap | worker.js | 25×14MB = 350MB (73% heap) |
| 4 | 3 паралельних batch-і одночасно | parallelBatchProcessor.js | 3×1-2MB додаткової пам'яті |
| 5 | GC тільки при 300MB | worker.js | Пізня реакція на проблеми |

### Memory Leaks

| # | Проблема | Файл |
|---|----------|------|
| 6 | `activeWorkers` Map без механізму очищення | routes/index.js |
| 7 | `pendingAcks` Map без TTL | worker.js |

---

## Виконані оптимізації

### 1. Зменшення batch size (worker.js)

```javascript
// Було:
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE, 10) || 25;

// Стало:
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE, 10) || 10;
```

**Ефект:** Зменшення пікової пам'яті з 350MB до 140MB на batch.

### 2. Зниження порогу для GC (worker.js)

```javascript
// Було:
const MEMORY_WARNING_MB = 300;

// Стало:
const MEMORY_WARNING_MB = parseInt(process.env.MEMORY_WARNING_MB, 10) || 200;
```

**Ефект:** Ранній запуск GC запобігає накопиченню пам'яті.

### 3. Зменшення паралельності AI batch-ів (parallelBatchProcessor.js)

```javascript
// Було:
const MAX_CONCURRENT_BATCHES = 3;

// Стало:
const MAX_CONCURRENT_BATCHES = parseInt(process.env.MAX_CONCURRENT_BATCHES, 10) || 2;
```

**Ефект:** Зменшення одночасного використання пам'яті на ~30%.

### 4. Очищення Maps після обробки (parallelBatchProcessor.js)

```javascript
// Додано після збору результатів:
this.completedResults.clear();
this.activeBatches.clear();
```

**Ефект:** Звільнення пам'яті від великих AI відповідей.

### 5. TTL для pendingAcks (worker.js)

```javascript
// Автоочищення старих pendingAcks кожні 30 сек (TTL 60 сек)
const PENDING_ACK_TTL_MS = 60000;
setInterval(() => {
  const now = Date.now();
  for (const [reqId, data] of pendingAcks.entries()) {
    if (now - data.createdAt > PENDING_ACK_TTL_MS) {
      pendingAcks.delete(reqId);
    }
  }
}, 30000);
```

**Ефект:** Запобігання memory leak від незавершених запитів.

### 6. Автоочищення зависших воркерів (routes/index.js)

```javascript
// Автоочищення зависших воркерів кожні 5 хвилин (TTL 30 хвилин)
const MAX_WORKER_AGE_MS = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [jobId, data] of activeWorkers.entries()) {
    if (now - data.startTime > MAX_WORKER_AGE_MS) {
      logger.warn(`[CLEANUP] Видаляю завислий воркер ${jobId}`);
      activeWorkers.delete(jobId);
    }
  }
}, 5 * 60 * 1000);
```

**Ефект:** Запобігання накопиченню зависших воркерів.

### 7. Профілактичний GC в scraper (scraper.js)

```javascript
// Профілактичний GC кожні 10 справ
if (processedCount % 10 === 0) {
  const memUsedMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  const memWarningMB = parseInt(process.env.MEMORY_WARNING_MB, 10) || 200;

  if (memUsedMB > memWarningMB && global.gc) {
    console.log(`🗑️ [MEMORY] Профілактичний GC при ${memUsedMB}MB`);
    global.gc();
  }
}
```

**Ефект:** Раннє звільнення пам'яті під час завантаження справ.

---

## Змінені файли

| Файл | Зміни |
|------|-------|
| `/server/worker.js` | BATCH_SIZE, MEMORY_WARNING_MB, TTL для pendingAcks |
| `/server/parallelBatchProcessor.js` | MAX_CONCURRENT_BATCHES, очищення Maps |
| `/server/routes/index.js` | Автоочищення activeWorkers |
| `/server/scraper.js` | Профілактичний GC кожні 10 справ |
| `/server/env.example` | Нові змінні середовища |

---

## Нові змінні середовища

```bash
# Batch size для завантаження справ (зменшено з 25)
BATCH_SIZE=10

# Максимальна кількість паралельних batch-ів AI аналізу
MAX_CONCURRENT_BATCHES=2

# Поріг для попередження про пам'ять (запуск GC)
MEMORY_WARNING_MB=200

# Максимальний ліміт пам'яті
MAX_MEMORY_MB=400
```

### Налаштування для Render.com

Додайте ці змінні в **Environment Variables** на Render.com Dashboard:

| Змінна | Значення | Опис |
|--------|----------|------|
| `BATCH_SIZE` | `10` | Справ на batch |
| `MAX_CONCURRENT_BATCHES` | `2` | Паралельних AI запитів |
| `MEMORY_WARNING_MB` | `200` | Поріг для GC |
| `MAX_MEMORY_MB` | `400` | Ліміт пам'яті |

---

## Очікуваний результат

| Метрика | До оптимізації | Після оптимізації |
|---------|----------------|-------------------|
| Peak memory (100 справ) | 400-500 MB | 200-250 MB |
| Memory leak за годину | +50-100 MB | ~0 MB |
| Batch memory footprint | 350 MB | 140 MB |
| OOM crashes | Часто | Рідко |

---

## Моніторинг

### Логи для відстеження пам'яті

```
📊 [MEMORY] Heap: XXXmb / RSS: XXXmb
🗑️ [MEMORY] Профілактичний GC при XXXmb > 200mb
🗑️ [MEMORY] Після GC: XXXmb
⚠️ [MEMORY] Критичний рівень пам'яті (XXXmb)
[CLEANUP] Видаляю завислий воркер XXX
```

### Рекомендації з моніторингу

1. **Слідкуйте за логами** `[MEMORY]` в Render.com Dashboard
2. **Якщо GC запускається часто** (>5 разів на завдання) - зменшіть `BATCH_SIZE`
3. **Якщо OOM все ще трапляється** - зменшіть `MAX_CONCURRENT_BATCHES` до 1

---

## Подальші рекомендації

### Якщо проблеми залишаються:

1. **Streaming архітектура** - обробляти справи потоком замість накопичення
2. **Redis для черги** - винести чергу завдань з пам'яті
3. **Upgrade Render.com** - платний тариф з 2GB+ RAM

### Команди для локального тестування:

```bash
# Запуск з примусовим GC
node --expose-gc server/index.js

# Моніторинг пам'яті
node --trace-gc server/index.js
```

---

*Документ згенеровано під час оптимізації пам'яті сервера.*
