// Global state
let currentPage = 'dashboard';
let authToken = null;
let currentUser = null;
const adminI18n = window.AdminI18n || {
  t: (key) => key,
  applyTranslations: () => {},
  getLocale: () => 'uk',
  setLocale: () => 'uk',
  formatDate: (value) => value,
  formatDateTime: (value) => value,
};
const { t, applyTranslations, getLocale, setLocale, formatDate, formatDateTime } = adminI18n;

// Initialize app
document.addEventListener('DOMContentLoaded', function () {
  initializeApp();
});

async function initializeApp() {
  applyTranslations(document);
  const localeSelect = document.getElementById('admin-locale');
  if (localeSelect) {
    localeSelect.value = getLocale();
    localeSelect.addEventListener('change', () => {
      setLocale(localeSelect.value);
      updatePageTitle(currentPage);
    });
  }

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
      throw new Error(t('login.verifyFailed'));
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
      throw new Error(error.error || t('login.authFailed'));
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
      throw new Error(t('login.noAdmin'));
    }

    if (!adminResponse.ok) {
      throw new Error(t('login.accessFailed'));
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

  updatePageTitle(page);

  currentPage = page;
  loadPageData(page);
}

function updatePageTitle(page) {
  const titles = {
    dashboard: t('nav.dashboard'),
    users: t('nav.users'),
    jobs: t('nav.jobs'),
    system: t('nav.system'),
    audit: t('nav.audit'),
    security: t('nav.security'),
  };
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = titles[page] || titles.dashboard;
}

// Jobs page state for sorting
let jobsEmailSortDir = null; // 'asc' | 'desc' | null

// Debounce timers for search (reduces API calls)
let usersSearchTimeout = null;
let jobsSearchTimeout = null;

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
    showError(t('messages.loadError', { message: error.message }));
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
      document.getElementById('current-user').textContent =
        currentUser.email || t('sidebar.adminLabel');
    } else {
      document.getElementById('current-user').textContent = t('sidebar.adminLabel');
    }
  } catch {
    document.getElementById('current-user').textContent = t('sidebar.adminLabel');
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
  document.getElementById('avg-duration').textContent =
    data.avg_job_duration !== null && data.avg_job_duration !== undefined
      ? formatDurationSeconds(data.avg_job_duration)
      : '-';
  document.getElementById('uptime').textContent =
    data.uptime_hours !== null && data.uptime_hours !== undefined
      ? `${data.uptime_hours.toFixed(1)} ${t('common.hoursShort')}`
      : '-';
}

async function loadUsers(page = 1, search = '') {
  const params = new URLSearchParams({ page, limit: 20 });
  if (search) params.append('search', search);

  const response = await apiCall(`/api/admin/users?${params}`);
  const tbody = document.getElementById('users-table-body');

  if (response.users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading">${t('users.empty')}</td></tr>`;
    return;
  }

  tbody.innerHTML = response.users
    .map(
      (user) => `
        <tr>
            <td>${escapeHtml(user.email)}</td>
            <td>${formatDate(user.created_at)}</td>
            <td>${user.last_sign_in_at ? formatDate(user.last_sign_in_at) : t('common.never')}</td>
            <td>
                ${
                  user.is_admin
                    ? `<span class="status-badge status-completed">${t('common.admin')}</span>`
                    : `<span class="status-badge status-pending">${t('common.user')}</span>`
                }
            </td>
            <td>
                <div class="action-buttons">
                    ${
                      !user.is_admin
                        ? `<button class="btn btn-primary btn-sm" onclick="makeAdmin('${escapeHtml(user.id)}')">
                            <i class="fas fa-user-shield"></i> ${t('actions.makeAdmin')}
                        </button>`
                        : user.id !== currentUser?.id
                          ? `<button class="btn btn-warning btn-sm" onclick="revokeAdmin('${escapeHtml(user.id)}')">
                                <i class="fas fa-user-times"></i> ${t('actions.revokeAdmin')}
                            </button>`
                          : `<span class="status-badge status-completed">${t('common.you')}</span>`
                    }
                    ${
                      user.id !== currentUser?.id
                        ? `<button class="btn btn-danger btn-sm" onclick="deleteUser('${escapeHtml(user.id)}', '${escapeHtml(user.email)}')">
                            <i class="fas fa-trash"></i> ${t('common.delete')}
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
    tbody.innerHTML = `<tr><td colspan="7" class="loading">${t('jobs.empty')}</td></tr>`;
    updatePagination('jobs', response.pagination);
    // Update total count
    const countEl = document.getElementById('jobs-results-count');
    if (countEl)
      countEl.textContent = t('common.foundCount', {
        count: response.pagination?.total || 0,
      });
    return;
  }

  tbody.innerHTML = jobs
    .map(
      (job) => `
        <tr>
            <td>
                <div class="job-title-cell">
                    <span id="title-${escapeHtml(job.id)}">${escapeHtml(job.title) || t('common.untitled')}</span>
                    <button class="btn btn-link btn-sm" onclick="editJobTitle('${escapeHtml(job.id)}', '${escapeHtml((job.title || '').replace(/'/g, "\\'"))}')" aria-label="Редактировать название">
                        <i class="fas fa-edit"></i>
                    </button>
                </div>
            </td>
            <td>${job.user_email ? escapeHtml(job.user_email) : `<span class="muted">${t('common.na')}</span>`}</td>
            <td><span class="status-badge status-${escapeHtml(job.status)}">${getStatusText(job.status)}</span></td>
            <td>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${parseInt(job.progress, 10) || 0}%"></div>
                </div>
                ${parseInt(job.progress, 10) || 0}%
            </td>
            <td>${parseInt(job.processed_links, 10) || 0} / ${parseInt(job.total_links, 10) || 0}</td>
            <td>${formatDate(job.created_at)}</td>
            <td>
                <div class="action-buttons">
                    ${
                      job.status === 'completed'
                        ? `<button class="btn btn-info btn-sm" onclick="viewJobReport('${escapeHtml(job.id)}')">
                            <i class="fas fa-file-alt"></i> ${t('common.report')}
                        </button>`
                        : ''
                    }
                    ${
                      job.status === 'error'
                        ? `<button class="btn btn-warning btn-sm" onclick="retryJob('${escapeHtml(job.id)}')" title="${t('actions.retryJob')}">
                            <i class="fas fa-redo"></i> ${t('actions.retryShort')}
                        </button>`
                        : ''
                    }
                    <button class="btn btn-danger btn-sm" onclick="deleteJob('${escapeHtml(job.id)}')">
                        <i class="fas fa-trash"></i> ${t('common.delete')}
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
  if (countEl)
    countEl.textContent = t('common.foundCount', {
      count: response.pagination?.total || 0,
    });
  return { jobsLength: jobs.length, pagination: response.pagination };
}

async function loadSystemStats() {
  const response = await apiCall('/api/admin/system/stats');
  const statsDiv = document.getElementById('system-stats');

  statsDiv.innerHTML = `
        <div class="stat-row">
            ${t('system.statsMemory', {
              used: response.system.memory.used,
              total: response.system.memory.heap_total,
            })}
        </div>
        <div class="stat-row">
            ${t('system.statsUptime', { value: response.system.uptime.formatted })}
        </div>
        <div class="stat-row">
            ${t('system.statsNode', { value: response.system.node_version })}
        </div>
        <div class="stat-row">
            ${t('system.statsPlatform', { value: response.system.platform })}
        </div>
        <br>
        <h4>${t('system.statsDbTitle')}</h4>
        ${response.database
          .map(
            (item) => `
            <div class="stat-row">
                ${t('system.statsRecords', { table: item.table_name, count: item.count })}
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
    tbody.innerHTML = `<tr><td colspan="5" class="loading">${t('audit.empty')}</td></tr>`;
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
                <td>${log.target_type || t('common.na')}${log.target_id ? ':' + log.target_id : ''}</td>
                <td>${log.ip_address || t('common.na')}</td>
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
                    <small>${t('securityReasons.reason', {
                      reason:
                        item.reason === 'email_attempts'
                          ? t('securityReasons.emailAttempts')
                          : t('securityReasons.ipSuspicious'),
                    })}</small><br>
                    <small>${t('securityReasons.remainingTime', { minutes: item.remainingTime })}</small>
                </div>
            `
        )
        .join('');
    } else {
      blockedList.innerHTML = `<p class="no-data">${t('security.blockedEmpty')}</p>`;
    }

    // Update failed attempts
    const attemptsList = document.getElementById('failed-attempts-list');
    if (response.failedAttempts && response.failedAttempts.length > 0) {
      attemptsList.innerHTML = response.failedAttempts
        .map(
          (item) => `
                <div class="attempt-item">
                    <strong>${item.target}</strong><br>
                    <small>${t('securityReasons.attemptsCount', { count: item.count })}</small><br>
                    <small>${t('securityReasons.lastAttempt', { time: formatDateTime(item.lastAttempt) })}</small>
                </div>
            `
        )
        .join('');
    } else {
      attemptsList.innerHTML = `<p class="no-data">${t('security.attemptsEmpty')}</p>`;
    }
  } catch (error) {
    showError(t('messages.securityLoadError', { message: error.message }));
  }
}

// Action functions
async function makeAdmin(userId) {
  if (!confirm(t('confirm.grantAdmin'))) return;

  try {
    await apiCall(`/api/admin/users/${userId}/make-admin`, 'POST');
    showSuccess(t('messages.adminGranted'));
    await loadUsers();
  } catch (error) {
    showError(t('messages.adminGrantError', { message: error.message }));
  }
}

async function revokeAdmin(userId) {
  if (!confirm(t('confirm.revokeAdmin'))) return;

  try {
    await apiCall(`/api/admin/users/${userId}/admin-role`, 'DELETE');
    showSuccess(t('messages.adminRevoked'));
    await loadUsers();
  } catch (error) {
    showError(t('messages.adminRevokeError', { message: error.message }));
  }
}

async function deleteUser(userId, email) {
  if (!confirm(t('confirm.deleteUser', { email }))) return;

  try {
    await apiCall(`/api/admin/users/${userId}`, 'DELETE');
    showSuccess(t('messages.userDeleted'));
    await loadUsers();
  } catch (error) {
    showError(t('messages.userDeleteError', { message: error.message }));
  }
}

async function deleteJob(jobId) {
  if (!confirm(t('confirm.deleteJob'))) return;

  try {
    await apiCall(`/api/admin/jobs/${jobId}`, 'DELETE');
    showSuccess(t('messages.jobDeleted'));
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
    showError(t('messages.jobDeleteError', { message: error.message }));
  }
}

async function retryJob(jobId) {
  if (!confirm(t('confirm.retryJob'))) return;

  try {
    await apiCall(`/api/admin/jobs/${jobId}/retry`, 'POST');
    showSuccess(t('messages.jobRetryQueued', { message: null }));

    // Refresh current page to show updated status
    const status = document.getElementById('jobs-status-filter').value;
    const search = document.getElementById('jobs-search').value;
    const email = document.getElementById('jobs-email-filter')?.value || '';
    const activePageBtn = document.querySelector('#jobs-pagination .active');
    const currentPage = activePageBtn ? parseInt(activePageBtn.textContent, 10) || 1 : 1;

    await loadJobs(currentPage, status, search, email);
  } catch (error) {
    showError(t('messages.jobRetryError', { message: error.message }));
  }
}

async function editJobTitle(jobId, currentTitle) {
  const newTitle = prompt(t('actions.editTitlePrompt'), currentTitle);
  if (!newTitle || newTitle === currentTitle) return;

  try {
    await apiCall(`/api/admin/jobs/${jobId}/title`, 'PUT', { title: newTitle });
    showSuccess(t('messages.jobTitleUpdated'));

    // Обновляем название в таблице без перезагрузки
    const titleElement = document.getElementById(`title-${jobId}`);
    if (titleElement) {
      titleElement.textContent = newTitle;
    }
  } catch (error) {
    showError(t('messages.jobTitleError', { message: error.message }));
  }
}

async function viewJobReport(jobId) {
  // Открываем отчет в новой вкладке
  const reportUrl = `/admin/report.html?jobId=${jobId}`;
  window.open(reportUrl, '_blank');
}

async function performCleanup(type) {
  const confirmMessages = {
    old_jobs: t('confirm.cleanupOldJobs'),
    failed_jobs: t('confirm.cleanupFailedJobs'),
    old_cache: t('confirm.cleanupOldCache'),
  };

  if (!confirm(confirmMessages[type])) return;

  try {
    showLoading();
    const response = await apiCall('/api/admin/system/cleanup', 'POST', { cleanupType: type });
    showSuccess(t('messages.cleanupSuccess', { count: response.cleaned || 0 }));
    await loadSystemStats();
  } catch (error) {
    showError(t('messages.cleanupError', { message: error.message }));
  } finally {
    hideLoading();
  }
}

async function retryAllFailedJobs() {
  if (!confirm(t('confirm.retryAllFailed'))) return;

  try {
    showLoading();
    const response = await apiCall('/api/admin/jobs/retry-failed', 'POST');
    showSuccess(t('messages.retryAllSuccess', { count: response.retried_count || 0 }));

    // Refresh current page only (dashboard has cache, no need to force reload)
    const currentPage = getCurrentPageName();
    if (currentPage === 'jobs') {
      const status = document.getElementById('jobs-status-filter').value;
      const search = document.getElementById('jobs-search').value;
      const email = document.getElementById('jobs-email-filter')?.value || '';
      const activePageBtn = document.querySelector('#jobs-pagination .active');
      const currentPageNum = activePageBtn ? parseInt(activePageBtn.textContent, 10) || 1 : 1;
      await loadJobs(currentPageNum, status, search, email);
    } else if (currentPage === 'dashboard') {
      await loadDashboard();
    }
  } catch (error) {
    showError(t('messages.retryAllError', { message: error.message }));
  } finally {
    hideLoading();
  }
}

async function recoverStuckJobsNow() {
  if (!confirm(t('confirm.recoverStuck'))) return;
  try {
    showLoading();
    const response = await apiCall('/api/admin/jobs/recover-stuck', 'POST', { grace_minutes: 5 });
    showSuccess(t('messages.recoverSuccess', { count: response.recovered || 0 }));

    // Refresh current page only
    const currentPage = getCurrentPageName();
    if (currentPage === 'jobs') {
      const status = document.getElementById('jobs-status-filter').value;
      const search = document.getElementById('jobs-search').value;
      const email = document.getElementById('jobs-email-filter')?.value || '';
      const activePageBtn = document.querySelector('#jobs-pagination .active');
      const currentPageNum = activePageBtn ? parseInt(activePageBtn.textContent, 10) || 1 : 1;
      await loadJobs(currentPageNum, status, search, email);
    } else if (currentPage === 'dashboard') {
      await loadDashboard();
    }
  } catch (error) {
    showError(t('messages.recoverError', { message: error.message }));
  } finally {
    hideLoading();
  }
}

async function viewErrorJobs() {
  try {
    showLoading();
    const response = await apiCall('/api/admin/jobs/errors?limit=50');

    if (response.jobs.length === 0) {
      showSuccess(t('messages.errorJobsEmpty'));
      return;
    }

    // Switch to jobs page and filter by error status
    navigateToPage('jobs');
    document.getElementById('jobs-status-filter').value = 'error';
    document.getElementById('jobs-search').value = '';
    document.getElementById('jobs-email-filter').value = '';
    await loadJobs(1, 'error', '', '');

    showSuccess(t('messages.errorJobsFound', { count: response.jobs.length }));
  } catch (error) {
    showError(t('messages.errorJobsLoadError', { message: error.message }));
  } finally {
    hideLoading();
  }
}

function getCurrentPageName() {
  const activeMenuItem = document.querySelector('.menu-item.active');
  return activeMenuItem ? activeMenuItem.dataset.page : 'dashboard';
}

// Search functions with debounce (300ms) to reduce API calls
function searchUsers() {
  clearTimeout(usersSearchTimeout);
  usersSearchTimeout = setTimeout(async () => {
    const search = document.getElementById('users-search').value;
    await loadUsers(1, search);
  }, 300);
}

function searchJobs() {
  clearTimeout(jobsSearchTimeout);
  jobsSearchTimeout = setTimeout(async () => {
    const search = document.getElementById('jobs-search').value;
    const status = document.getElementById('jobs-status-filter').value;
    const email = document.getElementById('jobs-email-filter')?.value || '';
    showJobsInlineLoading(true);
    try {
      await loadJobs(1, status, search, email);
    } finally {
      showJobsInlineLoading(false);
    }
  }, 300);
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
    throw new Error(t('messages.sessionExpired'));
  }

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'API request failed');
  }

  return await response.json();
}

// Format duration provided in seconds into human-readable string
function formatDurationSeconds(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const s = seconds % 60;
  const m = minutes % 60;
  if (hours > 0) return `${hours}${t('common.hoursShort')} ${m}${t('common.minutesShort')}`;
  if (minutes > 0) return `${minutes}${t('common.minutesShort')} ${s}${t('common.secondsShort')}`;
  return `${s}${t('common.secondsShort')}`;
}

function getStatusText(status) {
  const key = `status.${status}`;
  const value = t(key);
  return value === key ? status : value;
}

function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
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
  html += `<button ${page <= 1 ? 'disabled' : ''} onclick="changePage('${type}', ${page - 1})" aria-label="Предыдущая страница">
                <i class="fas fa-chevron-left"></i>
             </button>`;

  // Page numbers
  for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) {
    html += `<button class="${i === page ? 'active' : ''}" onclick="changePage('${type}', ${i})" aria-label="Страница ${i}" ${i === page ? 'aria-current="page"' : ''}>
                    ${i}
                 </button>`;
  }

  // Next button
  html += `<button ${page >= totalPages ? 'disabled' : ''} onclick="changePage('${type}', ${page + 1})" aria-label="Следующая страница">
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

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function showSuccess(message) {
  showToast(message, 'success');
}

function showError(message) {
  showToast(message, 'error');
}

// Mobile menu functions
function toggleMobileMenu() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.mobile-overlay');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('active');
}

function closeMobileMenu() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.mobile-overlay');
  sidebar.classList.remove('open');
  overlay.classList.remove('active');
}

Object.assign(window, {
  makeAdmin,
  revokeAdmin,
  deleteUser,
  deleteJob,
  retryJob,
  editJobTitle,
  viewJobReport,
  performCleanup,
  retryAllFailedJobs,
  recoverStuckJobsNow,
  viewErrorJobs,
  clearJobFilters,
  refreshCurrentPage,
  changePage,
  toggleMobileMenu,
  closeMobileMenu,
});
