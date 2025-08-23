// server/middleware/errorHandler.js

function errorHandler(err, req, res, next) {
  console.error(`❌ Глобальна помилка: ${err.message}`);
  console.error(err.stack);

  // Если заголовки уже были отправлены, передаем ошибку дальше
  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    success: false,
    error: 'Внутрішня помилка сервера',
    details: err.message, // Включаем детали только для разработки, в продакшене можно убрать
  });
}

export default errorHandler;
