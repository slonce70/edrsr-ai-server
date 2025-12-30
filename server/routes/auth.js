import express from 'express';

// Страница колбэка Supabase для подтверждения email и восстановления пароля
// Показывает простое UI и (для восстановления) позволяет задать новый пароль
const router = express.Router();

router.get('/callback', (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
  const acceptLang = String(req.headers['accept-language'] || '').toLowerCase();
  const langParam = String(req.query.lang || '').toLowerCase();
  const lang =
    langParam === 'ru' || langParam === 'uk' ? langParam : acceptLang.includes('uk') ? 'uk' : 'ru';
  const STRINGS = {
    ru: {
      pageTitle: 'Авторизация — EDRSR AI',
      titleProcessing: 'Обработка авторизации…',
      statusWait: 'Пожалуйста, подождите.',
      recoveryIntro: 'Введите новый пароль для своей учетной записи.',
      recoveryLabel: 'Новый пароль',
      recoveryPlaceholder: 'Минимум 8 символов',
      recoverySave: 'Сохранить пароль',
      recoveryCancel: 'Отмена',
      closeHint: 'Можно закрыть эту вкладку и вернуться в расширение.',
      errorAuth: 'Ошибка авторизации',
      errorAccessToken: 'Не удалось получить access_token. Перейдите по ссылке из письма ещё раз.',
      recoveryTitle: 'Восстановление пароля',
      recoveryHint: 'Введите новый пароль и нажмите «Сохранить пароль».',
      passwordTooShort: 'Пароль слишком короткий (минимум 8 символов).',
      savingPassword: 'Сохраняем пароль…',
      passwordUpdated: 'Пароль успешно обновлён. Теперь вы можете войти в расширении.',
      recoveryError: 'Не удалось обновить пароль: ',
      recoveryErrorTitle: 'Ошибка восстановления пароля',
      emailConfirmed: 'Email подтверждён',
      emailConfirmedHint: 'Спасибо! Можете вернуться в расширение и войти.',
      authLinkHint:
        'Ссылка открыта. Если вы ожидали восстановление пароля — проверьте, что перешли по последней ссылке из письма.',
      done: 'Готово',
    },
    uk: {
      pageTitle: 'Авторизація — EDRSR AI',
      titleProcessing: 'Обробка авторизації…',
      statusWait: 'Будь ласка, зачекайте.',
      recoveryIntro: 'Введіть новий пароль для свого облікового запису.',
      recoveryLabel: 'Новий пароль',
      recoveryPlaceholder: 'Мінімум 8 символів',
      recoverySave: 'Зберегти пароль',
      recoveryCancel: 'Скасувати',
      closeHint: 'Можна закрити цю вкладку і повернутися в розширення.',
      errorAuth: 'Помилка авторизації',
      errorAccessToken: 'Не вдалося отримати access_token. Перейдіть за посиланням з листа ще раз.',
      recoveryTitle: 'Відновлення пароля',
      recoveryHint: 'Введіть новий пароль і натисніть «Зберегти пароль».',
      passwordTooShort: 'Пароль занадто короткий (мінімум 8 символів).',
      savingPassword: 'Зберігаємо пароль…',
      passwordUpdated: 'Пароль успішно оновлено. Тепер ви можете увійти в розширенні.',
      recoveryError: 'Не вдалося оновити пароль: ',
      recoveryErrorTitle: 'Помилка відновлення пароля',
      emailConfirmed: 'Email підтверджено',
      emailConfirmedHint: 'Дякуємо! Можете повернутися в розширення та увійти.',
      authLinkHint:
        'Посилання відкрито. Якщо ви очікували відновлення пароля — перевірте, що перейшли за останнім посиланням з листа.',
      done: 'Готово',
    },
  };
  const t = (key) => (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.ru[key] || key;
  const html = `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${t('pageTitle')}</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; padding: 24px; background:#0b0b0c; color:#e6e6e6; }
      .card { max-width: 560px; margin: 24px auto; background: #151518; border: 1px solid #2a2a2e; border-radius: 12px; padding: 20px; }
      h1 { font-size: 18px; margin: 0 0 12px; }
      p { line-height: 1.5; color:#cfcfd4; }
      .ok { color: #7ddc7d; }
      .err { color: #ff7a7a; }
      .muted { color:#9a9aa1; font-size: 13px; }
      .hidden { display: none; }
      form { margin-top: 16px; }
      input[type=password] { width: 100%; padding: 10px 12px; border-radius: 8px; border:1px solid #2f2f35; background:#0f0f12; color:#e6e6e6; }
      button { margin-top: 12px; padding: 10px 14px; border-radius: 8px; border: 0; background: #3b82f6; color: white; cursor: pointer; }
      .row { display:flex; gap:12px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1 id="title">${t('titleProcessing')}</h1>
      <p id="status" class="muted">${t('statusWait')}</p>

      <div id="recovery" class="hidden">
        <p>${t('recoveryIntro')}</p>
        <form id="recovery-form">
          <label for="pwd" class="muted">${t('recoveryLabel')}</label>
          <input id="pwd" type="password" minlength="8" placeholder="${t(
            'recoveryPlaceholder'
          )}" required />
          <div class="row">
            <button type="submit">${t('recoverySave')}</button>
            <button type="button" id="cancel">${t('recoveryCancel')}</button>
          </div>
        </form>
        <p id="recovery-result" class="muted"></p>
      </div>
      <p class="muted">${t('closeHint')}</p>
    </div>

    <script>
      (function() {
        const params = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));

        // Из Supabase приходят параметры в hash: access_token, refresh_token, token_type, type
        const type = params.get('type') || hashParams.get('type');
        const error = params.get('error_description') || hashParams.get('error_description');
        const accessToken = hashParams.get('access_token');

        const titleEl = document.getElementById('title');
        const statusEl = document.getElementById('status');
        const recoveryBlock = document.getElementById('recovery');
        const resultEl = document.getElementById('recovery-result');

        function setStatus(msg, cls) {
          statusEl.textContent = msg;
          statusEl.className = cls || 'muted';
        }

        if (error) {
          titleEl.textContent = '${t('errorAuth')}';
          setStatus(error, 'err');
          return;
        }

        if (type === 'recovery') {
          titleEl.textContent = '${t('recoveryTitle')}';
          if (!accessToken) {
            setStatus('${t('errorAccessToken')}', 'err');
            return;
          }
          recoveryBlock.classList.remove('hidden');
          setStatus('${t('recoveryHint')}', 'muted');

          const form = document.getElementById('recovery-form');
          const cancel = document.getElementById('cancel');
          cancel.addEventListener('click', () => window.close());

          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const pwd = document.getElementById('pwd').value || '';
            if (pwd.length < 8) {
              resultEl.textContent = '${t('passwordTooShort')}';
              resultEl.className = 'err';
              return;
            }
            resultEl.textContent = '${t('savingPassword')}';
            resultEl.className = 'muted';
            try {
              const res = await fetch('${supabaseUrl}/auth/v1/user', {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': '${supabaseAnonKey}',
                  'Authorization': 'Bearer ' + accessToken,
                },
                body: JSON.stringify({ password: pwd }),
              });
              const json = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(json.error_description || json.error || res.statusText);
              resultEl.textContent = '${t('passwordUpdated')}';
              resultEl.className = 'ok';
              setStatus('${t('done')}', 'ok');
            } catch (e) {
              resultEl.textContent = '${t('recoveryError')}' + (e.message || e);
              resultEl.className = 'err';
              setStatus('${t('recoveryErrorTitle')}', 'err');
            }
          });
          return;
        }

        if (type === 'signup' || type === 'magiclink' || type === 'invite') {
          titleEl.textContent = '${t('emailConfirmed')}';
          setStatus('${t('emailConfirmedHint')}', 'ok');
          return;
        }

        titleEl.textContent = '${t('pageTitle')}';
        setStatus('${t('authLinkHint')}', 'muted');
      })();
    </script>
  </body>
  </html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
});

export default router;
