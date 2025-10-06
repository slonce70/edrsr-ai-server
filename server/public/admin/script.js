// Global state
let currentPage = 'dashboard';
let authToken = null;
let currentUser = null;

// Initialize app
document.addEventListener('DOMContentLoaded', function () {
  initializeApp();
});

async function initializeApp() {
  // Setup login form listener first
  setupLoginListener();

  // Check if we have a saved token
  authToken = localStorage.getItem('admin_token');

  if (!authToken) {
    showLoginModal();
    return;
  }

  // Verify token and load admin interface
  try {
    const response = await fetch('/api/admin/dashboard', {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (response.status === 401 || response.status === 403) {
      // Token expired or invalid
      localStorage.removeItem('admin_token');
      authToken = null;
      showLoginModal();
      return;
    }

    if (!response.ok) {
      throw new Error('Failed to verify admin access');
    }

    // Token is valid, initialize interface
    hideLoginModal();
    setupEventListeners();
    loadCurrentPage();
    loadCurrentUser();
  } catch (error) {
    console.error('Initialization error:', error);
    showLoginModal();
  }
}

function setupLoginListener() {
  // Login form
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }
}

function setupEventListeners() {
  // Menu navigation
  document.querySelectorAll('.menu-item').forEach((item) => {
    item.addEventListener('click', function (e) {
      e.preventDefault();
      const page = this.dataset.page;
      navigateToPage(page);
    });
  });

  // Login form already setup in setupLoginListener()

  // Search and filter handlers
  document.getElementById('users-search')?.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') searchUsers();
  });

  document.getElementById('jobs-search')?.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') searchJobs();
  });

  document.getElementById('jobs-status-filter')?.addEventListener('change', searchJobs);

  // Email filter: Enter to search
  document.getElementById('jobs-email-filter')?.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') searchJobs();
  });

  // Sort by email when header clicked
  const emailHeader = document.getElementById('jobs-email-header');
  if (emailHeader) {
    emailHeader.addEventListener('click', () => {
      // Toggle sort direction: null -> asc -> desc -> null
      if (!jobsEmailSortDir) jobsEmailSortDir = 'asc';
      else if (jobsEmailSortDir === 'asc') jobsEmailSortDir = 'desc';
      else jobsEmailSortDir = null;

      // Reload current page with current filters
      const page = document.querySelector('#jobs-pagination .active')?.textContent
        ? parseInt(document.querySelector('#jobs-pagination .active').textContent, 10)
        : 1;
      const status = document.getElementById('jobs-status-filter').value;
      const search = document.getElementById('jobs-search').value;
      const email = document.getElementById('jobs-email-filter')?.value || '';
      showJobsInlineLoading(true);
      loadJobs(page, status, search, email).finally(() => showJobsInlineLoading(false));
    });
  }
}

function showJobsInlineLoading(isLoading) {
  const el = document.getElementById('jobs-filter-loading');
  const btn = document.getElementById('jobs-search-btn');
  if (el) el.style.display = isLoading ? 'inline-flex' : 'none';
  if (btn) btn.disabled = !!isLoading;
}

async function handleLogin(e) {
  e.preventDefault();

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const errorDiv = document.getElementById('login-error');

  try {
    showLoading();

    // First, authenticate with Supabase
    const authResponse = await fetch('/api/auth/signin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    if (!authResponse.ok) {
      const error = await authResponse.json();
      throw new Error(error.error || 'Authentication failed');
    }

    const authData = await authResponse.json();
    authToken = authData.access_token;

    // Now verify admin access
    const adminResponse = await fetch('/api/admin/dashboard', {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (adminResponse.status === 403) {
      throw new Error('У вас нет прав администратора');
    }

    if (!adminResponse.ok) {
      throw new Error('Failed to access admin panel');
    }

    // Success
    localStorage.setItem('admin_token', authToken);
    hideLoginModal();
    hideLoading();

    // Initialize admin interface
    setupEventListeners();
    await loadCurrentPage();
    await loadCurrentUser();

    errorDiv.textContent = '';
  } catch (error) {
    hideLoading();
    errorDiv.textContent = error.message;
    console.error('Login error:', error);
  }
}

function logout() {
  localStorage.removeItem('admin_token');
  authToken = null;
  currentUser = null;
  showLoginModal();
}

function navigateToPage(page) {
  // Update active menu item
  document.querySelectorAll('.menu-item').forEach((item) => {
    item.classList.remove('active');
  });
  document.querySelector(`[data-page="${page}"]`).classList.add('active');

  // Hide all pages
  document.querySelectorAll('.page').forEach((p) => {
    p.classList.remove('active');
  });

  // Show target page
  document.getElementById(`${page}-page`).classList.add('active');

  // Update page title
  const titles = {
    dashboard: 'Дашборд',
    users: 'Пользователи',
    jobs: 'Задания',
    system: 'Система',
    audit: 'Аудит',
    security: 'Безопасность',
  };
  document.getElementById('page-title').textContent = titles[page];

  currentPage = page;
  loadPageData(page);
}

// Jobs page state for sorting
let jobsEmailSortDir = null; // 'asc' | 'desc' | null

async function loadPageData(page) {
  try {
    showLoading();

    switch (page) {
      case 'dashboard':
        await loadDashboard();
        break;
      case 'users':
        await loadUsers();
        break;
      case 'jobs':
        await loadJobs();
        break;
      case 'system':
        await loadSystemStats();
        break;
      case 'audit':
        await loadAuditLog();
        break;
      case 'security':
        await loadSecurityStats();
        break;
    }
  } catch (error) {
    console.error(`Error loading ${page}:`, error);
    showError(`Ошибка загрузки данных: ${error.message}`);
  } finally {
    hideLoading();
  }
}

async function loadCurrentPage() {
  await loadPageData(currentPage);
}

async function loadCurrentUser() {
  try {
    // Декодируем JWT токен чтобы получить user ID
    if (authToken) {
      const payload = JSON.parse(atob(authToken.split('.')[1]));
      currentUser = { id: payload.sub, email: payload.email };
      document.getElementById('current-user').textContent = currentUser.email || 'Администратор';
    } else {
      document.getElementById('current-user').textContent = 'Администратор';
    }
  } catch (error) {
    document.getElementById('current-user').textContent = 'Администратор';
  }
}

async function loadDashboard() {
  const response = await apiCall('/api/admin/dashboard');
  const data = response.data;

  // Update stats
  document.getElementById('total-users').textContent = data.total_users || 0;
  document.getElementById('total-jobs').textContent = data.total_jobs || 0;
  document.getElementById('completed-jobs').textContent = data.completed_jobs || 0;
  document.getElementById('failed-jobs').textContent = data.failed_jobs || 0;
  document.getElementById('retryable-jobs').textContent = data.retryable_jobs || 0;
  document.getElementById('memory-usage').textContent = data.memory_usage || 0;

  // Update dashboard cards
  document.getElementById('jobs-today').textContent = data.jobs_today || 0;
  document.getElementById('avg-duration').textContent = data.avg_job_duration
    ? formatDurationSeconds(data.avg_job_duration)
    : '-';
  document.getElementById('uptime').textContent = data.uptime_hours
    ? data.uptime_hours.toFixed(1) + 'ч'
    : '-';
}

async function loadUsers(page = 1, search = '') {
  const params = new URLSearchParams({ page, limit: 20 });
  if (search) params.append('search', search);

  const response = await apiCall(`/api/admin/users?${params}`);
  const tbody = document.getElementById('users-table-body');

  if (response.users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading">Пользователи не найдены</td></tr>';
    return;
  }

  tbody.innerHTML = response.users
    .map(
      (user) => `
        <tr>
            <td>${user.email}</td>
            <td>${formatDate(user.created_at)}</td>
            <td>${user.last_sign_in_at ? formatDate(user.last_sign_in_at) : 'Никогда'}</td>
            <td>
                ${
                  user.is_admin
                    ? '<span class="status-badge status-completed">Admin</span>'
                    : '<span class="status-badge status-pending">User</span>'
                }
            </td>
            <td>
                <div class="action-buttons">
                    ${
                      !user.is_admin
                        ? `<button class="btn btn-primary btn-sm" onclick="makeAdmin('${user.id}')">
                            <i class="fas fa-user-shield"></i> Сделать админом
                        </button>`
                        : user.id !== currentUser?.id
                          ? `<button class="btn btn-warning btn-sm" onclick="revokeAdmin('${user.id}')">
                                <i class="fas fa-user-times"></i> Отозвать права
                            </button>`
                          : '<span class="status-badge status-completed">Вы</span>'
                    }
                    ${
                      user.id !== currentUser?.id
                        ? `<button class="btn btn-danger btn-sm" onclick="deleteUser('${user.id}', '${user.email}')">
                            <i class="fas fa-trash"></i> Удалить
                        </button>`
                        : ''
                    }
                </div>
            </td>
        </tr>
    `
    )
    .join('');

  updatePagination('users', response.pagination);
}

async function loadJobs(page = 1, status = '', search = '', email = '') {
  const params = new URLSearchParams({ page, limit: 20 });
  if (status) params.append('status', status);
  if (search) params.append('search', search);
  if (email) params.append('email', email);

  const response = await apiCall(`/api/admin/jobs?${params}`);
  const tbody = document.getElementById('jobs-table-body');

  const jobs = Array.isArray(response.jobs) ? [...response.jobs] : [];

  // Email filter now handled server-side for full dataset

  // Client-side sort by email when header toggled
  if (jobsEmailSortDir) {
    jobs.sort((a, b) => {
      const ea = (a.user_email || '').toLowerCase();
      const eb = (b.user_email || '').toLowerCase();
      if (ea < eb) return jobsEmailSortDir === 'asc' ? -1 : 1;
      if (ea > eb) return jobsEmailSortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  if (jobs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading">Задания не найдены</td></tr>';
    updatePagination('jobs', response.pagination);
    // Update total count
    const countEl = document.getElementById('jobs-results-count');
    if (countEl) countEl.textContent = `Найдено: ${response.pagination.total || 0}`;
    return;
  }

  tbody.innerHTML = jobs
    .map(
      (job) => `
        <tr>
            <td>
                <div class="job-title-cell">
                    <span id="title-${job.id}">${job.title || 'Без названия'}</span>
                    <button class="btn btn-link btn-sm" onclick="editJobTitle('${job.id}', '${(job.title || '').replace(/'/g, "\\'")}')">
                        <i class="fas fa-edit"></i>
                    </button>
                </div>
            </td>
            <td>${job.user_email ? job.user_email : '<span class="muted">N/A</span>'}</td>
            <td><span class="status-badge status-${job.status}">${getStatusText(job.status)}</span></td>
            <td>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${job.progress || 0}%"></div>
                </div>
                ${job.progress || 0}%
            </td>
            <td>${job.processed_links || 0} / ${job.total_links || 0}</td>
            <td>${formatDate(job.created_at)}</td>
            <td>
                <div class="action-buttons">
                    ${
                      job.status === 'completed'
                        ? `<button class="btn btn-info btn-sm" onclick="viewJobReport('${job.id}')">
                            <i class="fas fa-file-alt"></i> Отчет
                        </button>`
                        : ''
                    }
                    ${
                      job.status === 'error'
                        ? `<button class="btn btn-warning btn-sm" onclick="retryJob('${job.id}')" title="Перезапустить задание">
                            <i class="fas fa-redo"></i> Retry
                        </button>`
                        : ''
                    }
                    <button class="btn btn-danger btn-sm" onclick="deleteJob('${job.id}')">
                        <i class="fas fa-trash"></i> Удалить
                    </button>
                </div>
            </td>
        </tr>
    `
    )
    .join('');

  // Keep original pagination totals
  updatePagination('jobs', response.pagination);
  // Update total count
  const countEl = document.getElementById('jobs-results-count');
  if (countEl) countEl.textContent = `Найдено: ${response.pagination.total || 0}`;
  return { jobsLength: jobs.length, pagination: response.pagination };
}

async function loadSystemStats() {
  const response = await apiCall('/api/admin/system/stats');
  const statsDiv = document.getElementById('system-stats');

  statsDiv.innerHTML = `
        <div class="stat-row">
            <strong>Память:</strong> ${response.system.memory.used} МБ используется / ${response.system.memory.heap_total} МБ выделено
        </div>
        <div class="stat-row">
            <strong>Время работы:</strong> ${response.system.uptime.formatted}
        </div>
        <div class="stat-row">
            <strong>Node.js:</strong> ${response.system.node_version}
        </div>
        <div class="stat-row">
            <strong>Платформа:</strong> ${response.system.platform}
        </div>
        <br>
        <h4>Статистика базы данных:</h4>
        ${response.database
          .map(
            (item) => `
            <div class="stat-row">
                <strong>${item.table_name}:</strong> ${item.count} записей
            </div>
        `
          )
          .join('')}
    `;
}

async function loadAuditLog(page = 1) {
  const response = await apiCall(`/api/admin/audit-log?page=${page}&limit=50`);
  const tbody = document.getElementById('audit-table-body');

  if (response.logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading">Логи аудита не найдены</td></tr>';
    return;
  }

  tbody.innerHTML = response.logs
    .map((log) => {
      const userDisplay = log.user_email
        ? `${log.user_email} (${log.user_id.substring(0, 8)}...)`
        : log.user_id;

      return `
            <tr>
                <td>${formatDateTime(log.created_at)}</td>
                <td>${userDisplay}</td>
                <td>${log.action}</td>
                <td>${log.target_type || 'N/A'}${log.target_id ? ':' + log.target_id : ''}</td>
                <td>${log.ip_address || 'N/A'}</td>
            </tr>
        `;
    })
    .join('');

  updatePagination('audit', response.pagination);
}

async function loadSecurityStats() {
  try {
    const response = await apiCall('/api/admin/security/stats');

    // Update blocked IPs/accounts
    const blockedList = document.getElementById('blocked-list');
    if (response.blockedIPs && response.blockedIPs.length > 0) {
      blockedList.innerHTML = response.blockedIPs
        .map(
          (item) => `
                <div class="blocked-item">
                    <strong>${item.target}</strong><br>
                    <small>Причина: ${item.reason === 'email_attempts' ? 'Много попыток входа' : 'Подозрительная активность IP'}</small><br>
                    <small>Осталось времени: ${item.remainingTime} мин</small>
                </div>
            `
        )
        .join('');
    } else {
      blockedList.innerHTML = '<p class="no-data">Нет заблокированных адресов</p>';
    }

    // Update failed attempts
    const attemptsList = document.getElementById('failed-attempts-list');
    if (response.failedAttempts && response.failedAttempts.length > 0) {
      attemptsList.innerHTML = response.failedAttempts
        .map(
          (item) => `
                <div class="attempt-item">
                    <strong>${item.target}</strong><br>
                    <small>Попыток: ${item.count}</small><br>
                    <small>Последняя: ${formatDateTime(item.lastAttempt)}</small>
                </div>
            `
        )
        .join('');
    } else {
      attemptsList.innerHTML = '<p class="no-data">Нет подозрительной активности</p>';
    }
  } catch (error) {
    showError('Ошибка загрузки статистики безопасности: ' + error.message);
  }
}

// Action functions
async function makeAdmin(userId) {
  if (!confirm('Предоставить права администратора этому пользователю?')) return;

  try {
    await apiCall(`/api/admin/users/${userId}/make-admin`, 'POST');
    showSuccess('Права администратора предоставлены');
    await loadUsers();
  } catch (error) {
    showError('Ошибка предоставления прав: ' + error.message);
  }
}

async function revokeAdmin(userId) {
  if (!confirm('Отозвать права администратора у этого пользователя?')) return;

  try {
    await apiCall(`/api/admin/users/${userId}/admin-role`, 'DELETE');
    showSuccess('Права администратора отозваны');
    await loadUsers();
  } catch (error) {
    showError('Ошибка отзыва прав: ' + error.message);
  }
}

async function deleteUser(userId, email) {
  if (
    !confirm(
      `Удалить пользователя ${email}? Это действие нельзя отменить и удалит все данные пользователя.`
    )
  )
    return;

  try {
    await apiCall(`/api/admin/users/${userId}`, 'DELETE');
    showSuccess('Пользователь удален');
    await loadUsers();
  } catch (error) {
    showError('Ошибка удаления пользователя: ' + error.message);
  }
}

async function deleteJob(jobId) {
  if (!confirm('Удалить это задание? Это действие нельзя отменить.')) return;

  try {
    await apiCall(`/api/admin/jobs/${jobId}`, 'DELETE');
    showSuccess('Задание удалено');
    // Preserve current page and filters; if page becomes empty, go back 1 page
    const status = document.getElementById('jobs-status-filter').value;
    const search = document.getElementById('jobs-search').value;
    const email = document.getElementById('jobs-email-filter')?.value || '';
    const activePageBtn = document.querySelector('#jobs-pagination .active');
    const currentPage = activePageBtn ? parseInt(activePageBtn.textContent, 10) || 1 : 1;

    const { jobsLength } = await loadJobs(currentPage, status, search, email);
    if (jobsLength === 0 && currentPage > 1) {
      await loadJobs(currentPage - 1, status, search, email);
    }
  } catch (error) {
    showError('Ошибка удаления задания: ' + error.message);
  }
}

async function retryJob(jobId) {
  if (
    !confirm('Перезапустить это задание? Оно будет поставлено в очередь на повторное выполнение.')
  )
    return;

  try {
    const response = await apiCall(`/api/admin/jobs/${jobId}/retry`, 'POST');
    showSuccess(response.message || 'Задание поставлено на повторное выполнение');

    // Refresh current page to show updated status
    const status = document.getElementById('jobs-status-filter').value;
    const search = document.getElementById('jobs-search').value;
    const email = document.getElementById('jobs-email-filter')?.value || '';
    const activePageBtn = document.querySelector('#jobs-pagination .active');
    const currentPage = activePageBtn ? parseInt(activePageBtn.textContent, 10) || 1 : 1;

    await loadJobs(currentPage, status, search, email);
  } catch (error) {
    showError('Ошибка перезапуска задания: ' + error.message);
  }
}

async function editJobTitle(jobId, currentTitle) {
  const newTitle = prompt('Введите новое название задания:', currentTitle);
  if (!newTitle || newTitle === currentTitle) return;

  try {
    await apiCall(`/api/admin/jobs/${jobId}/title`, 'PUT', { title: newTitle });
    showSuccess('Название задания обновлено');

    // Обновляем название в таблице без перезагрузки
    const titleElement = document.getElementById(`title-${jobId}`);
    if (titleElement) {
      titleElement.textContent = newTitle;
    }
  } catch (error) {
    showError('Ошибка обновления названия: ' + error.message);
  }
}

async function viewJobReport(jobId) {
  // Открываем отчет в новой вкладке
  const reportUrl = `/admin/report.html?jobId=${jobId}`;
  window.open(reportUrl, '_blank');
}

async function performCleanup(type) {
  const confirmMessages = {
    old_jobs: 'Удалить все задания старше 90 дней?',
    failed_jobs: 'Удалить все проваленные задания старше 7 дней?',
    old_cache: 'Очистить кеш старше 30 дней?',
  };

  if (!confirm(confirmMessages[type])) return;

  try {
    showLoading();
    const response = await apiCall('/api/admin/system/cleanup', 'POST', { cleanupType: type });
    showSuccess(response.message);
    await loadSystemStats();
  } catch (error) {
    showError('Ошибка очистки: ' + error.message);
  } finally {
    hideLoading();
  }
}

async function retryAllFailedJobs() {
  if (
    !confirm(
      'Перезапустить все задания с временными ошибками? Они будут поставлены в очередь на повторное выполнение.'
    )
  )
    return;

  try {
    showLoading();
    const response = await apiCall('/api/admin/jobs/retry-failed', 'POST');
    showSuccess(response.message || `Перезапущено ${response.retried_count || 0} заданий`);

    // Refresh dashboard stats and current page if we're on jobs page
    await loadDashboard();
    const currentPage = getCurrentPageName();
    if (currentPage === 'jobs') {
      const status = document.getElementById('jobs-status-filter').value;
      const search = document.getElementById('jobs-search').value;
      const email = document.getElementById('jobs-email-filter')?.value || '';
      const activePageBtn = document.querySelector('#jobs-pagination .active');
      const currentPageNum = activePageBtn ? parseInt(activePageBtn.textContent, 10) || 1 : 1;
      await loadJobs(currentPageNum, status, search, email);
    }
  } catch (error) {
    showError('Ошибка массового перезапуска: ' + error.message);
  } finally {
    hideLoading();
  }
}

async function recoverStuckJobsNow() {
  if (!confirm('Восстановить зависшие задания (без ожидания lease)?')) return;
  try {
    showLoading();
    const response = await apiCall('/api/admin/jobs/recover-stuck', 'POST', { grace_minutes: 5 });
    showSuccess(`Восстановлено ${response.recovered || 0} заданий`);
    await loadDashboard();
    const currentPage = getCurrentPageName();
    if (currentPage === 'jobs') {
      const status = document.getElementById('jobs-status-filter').value;
      const search = document.getElementById('jobs-search').value;
      const email = document.getElementById('jobs-email-filter')?.value || '';
      const activePageBtn = document.querySelector('#jobs-pagination .active');
      const currentPageNum = activePageBtn ? parseInt(activePageBtn.textContent, 10) || 1 : 1;
      await loadJobs(currentPageNum, status, search, email);
    }
  } catch (error) {
    showError('Ошибка восстановления: ' + error.message);
  } finally {
    hideLoading();
  }
}

async function viewErrorJobs() {
  try {
    showLoading();
    const response = await apiCall('/api/admin/jobs/errors?limit=50');

    if (response.jobs.length === 0) {
      showSuccess('Заданий с ошибками не найдено!');
      return;
    }

    // Switch to jobs page and filter by error status
    navigateToPage('jobs');
    document.getElementById('jobs-status-filter').value = 'error';
    document.getElementById('jobs-search').value = '';
    document.getElementById('jobs-email-filter').value = '';
    await loadJobs(1, 'error', '', '');

    showSuccess(`Найдено ${response.jobs.length} заданий с ошибками`);
  } catch (error) {
    showError('Ошибка загрузки заданий с ошибками: ' + error.message);
  } finally {
    hideLoading();
  }
}

function getCurrentPageName() {
  const activeMenuItem = document.querySelector('.menu-item.active');
  return activeMenuItem ? activeMenuItem.dataset.page : 'dashboard';
}

// Search functions
async function searchUsers() {
  const search = document.getElementById('users-search').value;
  await loadUsers(1, search);
}

async function searchJobs() {
  const search = document.getElementById('jobs-search').value;
  const status = document.getElementById('jobs-status-filter').value;
  const email = document.getElementById('jobs-email-filter')?.value || '';
  showJobsInlineLoading(true);
  try {
    await loadJobs(1, status, search, email);
  } finally {
    showJobsInlineLoading(false);
  }
}

function clearJobFilters() {
  const statusSel = document.getElementById('jobs-status-filter');
  const emailInp = document.getElementById('jobs-email-filter');
  const searchInp = document.getElementById('jobs-search');
  if (statusSel) statusSel.value = '';
  if (emailInp) emailInp.value = '';
  if (searchInp) searchInp.value = '';
  jobsEmailSortDir = null;
  showJobsInlineLoading(true);
  loadJobs(1, '', '', '').finally(() => showJobsInlineLoading(false));
}

function refreshCurrentPage() {
  loadCurrentPage();
}

// Report modal functions removed - now using separate page

// Utility functions
async function apiCall(url, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (response.status === 401 || response.status === 403) {
    logout();
    throw new Error('Сессия истекла. Пожалуйста, войдите снова.');
  }

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'API request failed');
  }

  return await response.json();
}

function formatDate(dateString) {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleDateString('ru-RU');
}

function formatDateTime(dateString) {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleString('ru-RU');
}

// Format duration provided in seconds into human-readable string
function formatDurationSeconds(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const s = seconds % 60;
  const m = minutes % 60;
  if (hours > 0) return `${hours}ч ${m}м`;
  if (minutes > 0) return `${minutes}м ${s}с`;
  return `${s}с`;
}

function getStatusText(status) {
  const statusMap = {
    pending: 'Ожидание',
    processing: 'Обработка',
    completed: 'Завершено',
    error: 'Ошибка',
    queued: 'В очереди',
  };
  return statusMap[status] || status;
}

function updatePagination(type, pagination) {
  const container = document.getElementById(`${type}-pagination`);
  if (!container) return;

  const { page, limit, total } = pagination;
  const totalPages = Math.ceil(total / limit);

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';

  // Previous button
  html += `<button ${page <= 1 ? 'disabled' : ''} onclick="changePage('${type}', ${page - 1})">
                <i class="fas fa-chevron-left"></i>
             </button>`;

  // Page numbers
  for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) {
    html += `<button class="${i === page ? 'active' : ''}" onclick="changePage('${type}', ${i})">
                    ${i}
                 </button>`;
  }

  // Next button
  html += `<button ${page >= totalPages ? 'disabled' : ''} onclick="changePage('${type}', ${page + 1})">
                <i class="fas fa-chevron-right"></i>
             </button>`;

  container.innerHTML = html;
}

async function changePage(type, page) {
  switch (type) {
    case 'users': {
      const search = document.getElementById('users-search').value;
      await loadUsers(page, search);
      break;
    }
    case 'jobs': {
      const jobSearch = document.getElementById('jobs-search').value;
      const status = document.getElementById('jobs-status-filter').value;
      const email = document.getElementById('jobs-email-filter')?.value || '';
      await loadJobs(page, status, jobSearch, email);
      break;
    }
    case 'audit': {
      await loadAuditLog(page);
      break;
    }
    case 'security': {
      await loadSecurityStats();
      break;
    }
  }
}

// UI utility functions
function showLoginModal() {
  document.getElementById('login-modal').classList.add('active');
}

function hideLoginModal() {
  document.getElementById('login-modal').classList.remove('active');
}

function showLoading() {
  document.getElementById('loading-overlay').classList.add('active');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('active');
}

function showSuccess(message) {
  // Simple alert for now - could be replaced with a toast notification
  alert('✅ ' + message);
}

function showError(message) {
  // Simple alert for now - could be replaced with a toast notification
  alert('❌ ' + message);
}
