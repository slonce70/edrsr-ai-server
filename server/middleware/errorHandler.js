// server/middleware/errorHandler.js

function errorHandler(err, req, res, next) {
  // Логи всегда на сервере; в ответ клиенту — минимум информации в продакшне
  console.error(`❌ Глобальная ошибка: ${err.message}`);
  if (process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  }

  // Если заголовки уже были отправлены, передаем ошибку дальше
  if (res.headersSent) {
    return next(err);
  }

  const payload = {
    success: false,
    error: 'Внутренняя ошибка сервера',
  };
  if (process.env.NODE_ENV !== 'production') {
    payload.details = err.message;
  }
  res.status(500).json(payload);
}

export default errorHandler;
