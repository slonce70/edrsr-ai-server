import express from 'express';

// Страница колбэка Supabase для подтверждения email и восстановления пароля
// Показывает простое UI и (для восстановления) позволяет задать новый пароль
const router = express.Router();

router.get('/callback', (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
  const html = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Авторизация — EDRSR AI</title>
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
      <h1 id="title">Обработка авторизации…</h1>
      <p id="status" class="muted">Пожалуйста, подождите.</p>

      <div id="recovery" class="hidden">
        <p>Введите новый пароль для своей учетной записи.</p>
        <form id="recovery-form">
          <label for="pwd" class="muted">Новый пароль</label>
          <input id="pwd" type="password" minlength="8" placeholder="Минимум 8 символов" required />
          <div class="row">
            <button type="submit">Сохранить пароль</button>
            <button type="button" id="cancel">Отмена</button>
          </div>
        </form>
        <p id="recovery-result" class="muted"></p>
      </div>
      <p class="muted">Можно закрыть эту вкладку и вернуться в расширение.</p>
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
          titleEl.textContent = 'Ошибка авторизации';
          setStatus(error, 'err');
          return;
        }

        if (type === 'recovery') {
          titleEl.textContent = 'Восстановление пароля';
          if (!accessToken) {
            setStatus('Не удалось получить access_token. Перейдите по ссылке из письма ещё раз.', 'err');
            return;
          }
          recoveryBlock.classList.remove('hidden');
          setStatus('Введите новый пароль и нажмите «Сохранить пароль».', 'muted');

          const form = document.getElementById('recovery-form');
          const cancel = document.getElementById('cancel');
          cancel.addEventListener('click', () => window.close());

          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const pwd = document.getElementById('pwd').value || '';
            if (pwd.length < 8) {
              resultEl.textContent = 'Пароль слишком короткий (минимум 8 символов).';
              resultEl.className = 'err';
              return;
            }
            resultEl.textContent = 'Сохраняем пароль…';
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
              resultEl.textContent = 'Пароль успешно обновлён. Теперь вы можете войти в расширении.';
              resultEl.className = 'ok';
              setStatus('Готово', 'ok');
            } catch (e) {
              resultEl.textContent = 'Не удалось обновить пароль: ' + (e.message || e);
              resultEl.className = 'err';
              setStatus('Ошибка восстановления пароля', 'err');
            }
          });
          return;
        }

        if (type === 'signup' || type === 'magiclink' || type === 'invite') {
          titleEl.textContent = 'Email подтверждён';
          setStatus('Спасибо! Можете вернуться в расширение и войти.', 'ok');
          return;
        }

        titleEl.textContent = 'Авторизация';
        setStatus('Ссылка открыта. Если вы ожидали восстановление пароля — проверьте, что перешли по последней ссылке из письма.', 'muted');
      })();
    </script>
  </body>
  </html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
});

export default router;

