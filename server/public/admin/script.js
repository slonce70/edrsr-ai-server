// Global state
let currentPage = 'dashboard';
let authToken = null;
let currentUser = null;
let currentUserIsSuperAdmin = false;
const TOKEN_STORAGE_KEY = 'admin_token';
const LAST_ACTIVITY_KEY = 'admin_last_activity';
const ADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
let idleTimerId = null;
let eventsInitialized = false;
let activeModal = null;
let lastFocusedBeforeModal = null;
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
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
  authToken = getStoredToken();

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
      clearStoredToken();
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
    recordActivity();
    startIdleWatcher();
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

// One-time legacy purge: remove any token previously mirrored into localStorage
// so existing users are migrated to sessionStorage-only even without logging out.
localStorage.removeItem(TOKEN_STORAGE_KEY);

function getStoredToken() {
  return sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

function setStoredToken(token) {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
}

function clearStoredToken() {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  sessionStorage.removeItem(LAST_ACTIVITY_KEY);
}

function recordActivity() {
  if (!authToken) return;
  sessionStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
}

function attachActivityListeners() {
  const events = ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'];
  events.forEach((event) => {
    document.addEventListener(event, recordActivity, { passive: true });
  });
}

function startIdleWatcher() {
  if (idleTimerId) return;
  idleTimerId = setInterval(() => {
    if (!authToken) return;
    const last = Number.parseInt(sessionStorage.getItem(LAST_ACTIVITY_KEY) || '0', 10);
    if (last && Date.now() - last > ADMIN_IDLE_TIMEOUT_MS) {
      logout({ reason: t('messages.sessionExpired') });
    }
  }, 60000);
}

function setupEventListeners() {
  if (eventsInitialized) return;
  eventsInitialized = true;
  // Menu navigation
  document.querySelectorAll('.menu-item').forEach((item) => {
    item.addEventListener('click', function (e) {
      e.preventDefault();
      const page = this.dataset.page;
      navigateToPage(page);
    });
  });

  // Login form already setup in setupLoginListener()

  // Header / global actions
  document.getElementById('logout-btn')?.addEventListener('click', () => logout());
  document.getElementById('mobile-menu-btn')?.addEventListener('click', toggleMobileMenu);
  document.getElementById('mobile-overlay')?.addEventListener('click', closeMobileMenu);
  document.getElementById('refresh-btn')?.addEventListener('click', refreshCurrentPage);

  // Search and filter handlers
  document.getElementById('users-search')?.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') searchUsers();
  });
  document.getElementById('users-search-btn')?.addEventListener('click', searchUsers);

  document.getElementById('jobs-search')?.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') searchJobs();
  });

  document.getElementById('jobs-search-btn')?.addEventListener('click', searchJobs);
  document.getElementById('jobs-clear-btn')?.addEventListener('click', clearJobFilters);
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

  // System actions
  document.querySelectorAll('[data-cleanup]')?.forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-cleanup');
      if (type) performCleanup(type);
    });
  });
  document.getElementById('recover-stuck-btn')?.addEventListener('click', recoverStuckJobsNow);
  document.getElementById('retry-failed-btn')?.addEventListener('click', retryAllFailedJobs);
  document.getElementById('view-error-jobs-btn')?.addEventListener('click', viewErrorJobs);
  document.getElementById('security-refresh-btn')?.addEventListener('click', loadSecurityStats);
  document.getElementById('workers-refresh-btn')?.addEventListener('click', loadWorkersQueue);
  document
    .getElementById('workers-terminate-all-btn')
    ?.addEventListener('click', terminateAllWorkers);
  document.getElementById('gemini-refresh-btn')?.addEventListener('click', loadGeminiStats);
  document.getElementById('gemini-reset-btn')?.addEventListener('click', resetGeminiStats);

  // Job details modal
  document.getElementById('job-details-close')?.addEventListener('click', closeJobDetailsModal);
  document.getElementById('job-details-modal')?.addEventListener('click', (e) => {
    if (e.target?.id === 'job-details-modal') closeJobDetailsModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeModal?.id === 'job-details-modal') {
      closeJobDetailsModal();
    }
  });

  setupTableActionHandlers();
  setupPaginationHandlers();
  attachActivityListeners();
}

function showJobsInlineLoading(isLoading) {
  const el = document.getElementById('jobs-filter-loading');
  const btn = document.getElementById('jobs-search-btn');
  if (el) el.style.display = isLoading ? 'inline-flex' : 'none';
  if (btn) btn.disabled = !!isLoading;
}

function getLoginErrorMessage(payload) {
  const code = payload?.error_code;
  switch (code) {
    case 'invalid_credentials':
      return t('login.invalidCredentials');
    case 'email_not_confirmed':
      return t('login.emailNotConfirmed');
    case 'missing_credentials':
      return t('login.missingCredentials');
    case 'rate_limited':
      return t('login.rateLimited');
    case 'supabase_not_configured':
      return t('login.supabaseNotConfigured');
    default:
      break;
  }

  const raw = String(payload?.error || '');
  if (/invalid login credentials/i.test(raw) || /invalid email or password/i.test(raw)) {
    return t('login.invalidCredentials');
  }
  if (/email not confirmed/i.test(raw)) return t('login.emailNotConfirmed');
  if (/supabase not configured/i.test(raw)) return t('login.supabaseNotConfigured');
  if (/email and password are required/i.test(raw)) return t('login.missingCredentials');
  return raw || t('login.authFailed');
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
      const errorPayload = await authResponse.json().catch(() => ({}));
      throw new Error(getLoginErrorMessage(errorPayload));
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
    setStoredToken(authToken);
    recordActivity();
    startIdleWatcher();
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

function logout({ reason } = {}) {
  clearStoredToken();
  authToken = null;
  currentUser = null;
  showLoginModal();
  if (reason) showError(reason);
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
    workers: t('nav.workers'),
    gemini: t('nav.gemini'),
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
      case 'workers':
        await loadWorkersQueue();
        break;
      case 'gemini':
        await loadGeminiStats();
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

  currentUserIsSuperAdmin = !!data.is_super_admin;
  updateGeminiResetVisibility();
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
                        ? `<button class="btn btn-primary btn-sm" data-action="make-admin" data-user-id="${escapeHtml(user.id)}">
                            <i class="fas fa-user-shield"></i> ${t('actions.makeAdmin')}
                        </button>`
                        : user.id !== currentUser?.id
                          ? `<button class="btn btn-warning btn-sm" data-action="revoke-admin" data-user-id="${escapeHtml(user.id)}">
                                <i class="fas fa-user-times"></i> ${t('actions.revokeAdmin')}
                            </button>`
                          : `<span class="status-badge status-completed">${t('common.you')}</span>`
                    }
                    ${
                      user.id !== currentUser?.id
                        ? `<button class="btn btn-danger btn-sm" data-action="delete-user" data-user-id="${escapeHtml(user.id)}" data-user-email="${escapeHtml(user.email)}">
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
                    <button class="btn btn-link btn-sm" data-action="edit-job-title" data-job-id="${escapeHtml(job.id)}" data-job-title="${encodeURIComponent(job.title || '')}" aria-label="${t('common.editTitle')}">
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
                        ? `<button class="btn btn-info btn-sm" data-action="view-report" data-job-id="${escapeHtml(job.id)}">
                            <i class="fas fa-file-alt"></i> ${t('common.report')}
                        </button>`
                        : ''
                    }
                    ${
                      job.status === 'error'
                        ? `<button class="btn btn-warning btn-sm" data-action="retry-job" data-job-id="${escapeHtml(job.id)}" title="${t('actions.retryJob')}">
                            <i class="fas fa-redo"></i> ${t('actions.retryShort')}
                        </button>`
                        : ''
                    }
                    <button class="btn btn-secondary btn-sm" data-action="job-details" data-job-id="${escapeHtml(job.id)}">
                        <i class="fas fa-info-circle"></i> ${t('actions.details')}
                    </button>
                    <button class="btn btn-danger btn-sm" data-action="delete-job" data-job-id="${escapeHtml(job.id)}">
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
      const userEmail = log.user_email ? escapeHtml(log.user_email) : null;
      const userId = log.user_id ? escapeHtml(log.user_id) : '';
      const userDisplay = userEmail ? `${userEmail} (${userId.substring(0, 8)}...)` : userId;
      const action = escapeHtml(log.action);
      const targetType = log.target_type ? escapeHtml(log.target_type) : t('common.na');
      const targetId = log.target_id ? escapeHtml(log.target_id) : '';
      const ip = log.ip_address ? escapeHtml(log.ip_address) : t('common.na');

      return `
            <tr>
                <td>${formatDateTime(log.created_at)}</td>
                <td>${userDisplay}</td>
                <td>${action}</td>
                <td>${targetType}${targetId ? ':' + targetId : ''}</td>
                <td>${ip}</td>
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
                    <strong>${escapeHtml(item.target)}</strong><br>
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
                    <strong>${escapeHtml(item.target)}</strong><br>
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

async function loadWorkersQueue() {
  try {
    const [workersRes, systemRes] = await Promise.all([
      apiCall('/api/workers/active'),
      apiCall('/api/system/stats'),
    ]);

    // Queue/System stats
    const queue = systemRes.queue || {};
    const memory = systemRes.memory || {};
    const uptimeSeconds = Number.isFinite(systemRes.uptime) ? systemRes.uptime : 0;

    document.getElementById('workers-queue-length').textContent = queue.length ?? 0;
    document.getElementById('workers-queue-processing').textContent = queue.isProcessing
      ? t('workers.queueProcessingYes')
      : t('workers.queueProcessingNo');
    document.getElementById('workers-queue-cached').textContent = queue.cachedCookies ?? 0;
    document.getElementById('workers-memory').textContent = `${memory.heapUsed ?? 0} / ${
      memory.heapTotal ?? 0
    } MB`;
    document.getElementById('workers-uptime').textContent = formatDurationSeconds(
      Math.round(uptimeSeconds)
    );

    // Workers list
    const tbody = document.getElementById('workers-table-body');
    const workers = workersRes.workers || [];
    const total = workersRes.count || 0;
    const countEl = document.getElementById('workers-active-count');
    if (countEl) countEl.textContent = String(total);

    if (workers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="loading">${t('workers.empty')}</td></tr>`;
      return;
    }

    tbody.innerHTML = workers
      .map(
        (w) => `
        <tr>
          <td>${escapeHtml(w.jobId)}</td>
          <td>${escapeHtml(w.status || '')}</td>
          <td>${escapeHtml(w.runningTimeFormatted || '')}</td>
          <td>
            <button class="btn btn-warning btn-sm" data-action="terminate-worker" data-job-id="${escapeHtml(
              w.jobId
            )}">
              <i class="fas fa-stop"></i> ${t('workers.terminate')}
            </button>
          </td>
        </tr>
      `
      )
      .join('');
  } catch (error) {
    showError(t('messages.loadError', { message: error.message }));
  }
}

async function terminateWorker(jobId) {
  if (!confirm(t('confirm.terminateWorker'))) return;
  try {
    await apiCall(`/api/workers/${jobId}/terminate`, 'POST', {
      reason: 'Admin terminate via UI',
    });
    showSuccess(t('messages.workerTerminated'));
    await loadWorkersQueue();
  } catch (error) {
    showError(t('messages.workerTerminateError', { message: error.message }));
  }
}

async function terminateAllWorkers() {
  if (!confirmWithKeyword(t('confirm.terminateAllWorkers'), 'STOP', t('confirm.typeStop'))) return;
  try {
    await apiCall('/api/workers/terminate-all', 'POST', {
      reason: 'Admin terminate-all via UI',
    });
    showSuccess(t('messages.workersTerminated'));
    await loadWorkersQueue();
  } catch (error) {
    showError(t('messages.workersTerminateError', { message: error.message }));
  }
}

async function loadGeminiStats() {
  try {
    const response = await apiCall('/api/admin/gemini/stats');
    const stats = response.data || {};
    currentUserIsSuperAdmin = !!response.is_super_admin;
    updateGeminiResetVisibility();

    document.getElementById('gemini-total-keys').textContent = stats.totalKeys ?? 0;
    document.getElementById('gemini-available-keys').textContent = stats.availableKeys ?? 0;
    document.getElementById('gemini-queued-jobs').textContent = stats.queuedJobs ?? 0;
    document.getElementById('gemini-total-requests').textContent =
      stats.summary?.totalRequests ?? 0;
    document.getElementById('gemini-total-errors').textContent = stats.summary?.totalErrors ?? 0;
    document.getElementById('gemini-total-rate-limits').textContent =
      stats.summary?.totalRateLimits ?? 0;
    document.getElementById('gemini-keys-on-cooldown').textContent =
      stats.summary?.keysOnCooldown ?? 0;
    document.getElementById('gemini-updated-at').textContent = stats.timestamp
      ? formatDateTime(stats.timestamp)
      : t('common.na');

    const usageBody = document.getElementById('gemini-usage-body');
    const usage = Array.isArray(stats.usage) ? stats.usage : [];
    if (usage.length === 0) {
      usageBody.innerHTML = `<tr><td colspan="5" class="loading">${t(
        'gemini.usageEmpty'
      )}</td></tr>`;
    } else {
      usageBody.innerHTML = usage
        .map(
          (u) => `
        <tr>
          <td>${escapeHtml(String(u.key))}</td>
          <td>${escapeHtml(String(u.requests ?? 0))}</td>
          <td>${escapeHtml(String(u.errors ?? 0))}</td>
          <td>${escapeHtml(String(u.rateLimits ?? 0))}</td>
          <td>${u.invalid ? t('common.yes') : t('common.no')}</td>
        </tr>
      `
        )
        .join('');
    }

    const cooldownList = document.getElementById('gemini-cooldowns');
    const cooldowns = Array.isArray(stats.cooldowns) ? stats.cooldowns : [];
    if (cooldowns.length === 0) {
      cooldownList.innerHTML = `<li class="muted">${t('gemini.cooldownsEmpty')}</li>`;
    } else {
      cooldownList.innerHTML = cooldowns
        .map(
          (c) =>
            `<li>${t('gemini.keyLabel', { key: c.keyIndex })}: ${escapeHtml(
              String(c.remainingSeconds)
            )}s</li>`
        )
        .join('');
    }

    const softBanList = document.getElementById('gemini-softbans');
    const softBans = Array.isArray(stats.softBans) ? stats.softBans : [];
    if (softBans.length === 0) {
      softBanList.innerHTML = `<li class="muted">${t('gemini.softbansEmpty')}</li>`;
    } else {
      softBanList.innerHTML = softBans
        .map(
          (c) =>
            `<li>${t('gemini.keyLabel', { key: c.keyIndex })}: ${escapeHtml(
              String(c.remainingSeconds)
            )}s</li>`
        )
        .join('');
    }
  } catch (error) {
    showError(t('messages.geminiLoadError', { message: error.message }));
  }
}

async function resetGeminiStats() {
  if (!currentUserIsSuperAdmin) {
    showError(t('messages.geminiResetDenied'));
    return;
  }
  if (!confirmWithKeyword(t('confirm.resetGeminiStats'), 'RESET', t('confirm.typeReset'))) return;
  try {
    await apiCall('/api/admin/gemini/reset-stats', 'POST');
    showSuccess(t('messages.geminiResetSuccess'));
    await loadGeminiStats();
  } catch (error) {
    showError(t('messages.geminiResetError', { message: error.message }));
  }
}

function updateGeminiResetVisibility() {
  const btn = document.getElementById('gemini-reset-btn');
  if (!btn) return;
  btn.style.display = currentUserIsSuperAdmin ? 'inline-flex' : 'none';
}

async function showJobDetails(jobId) {
  try {
    showLoading();
    const response = await apiCall(`/api/admin/jobs/${jobId}/details`);
    const job = response.job || {};
    const stats = response.link_stats || {};

    document.getElementById('job-details-title').textContent = job.title || t('common.untitled');

    document.getElementById('job-details-body').innerHTML = `
      <div class="details-grid">
        <div>
          <h4>${t('jobDetails.sectionJob')}</h4>
          <div class="detail-row"><strong>${t('jobDetails.id')}:</strong> ${escapeHtml(
            job.id || ''
          )}</div>
          <div class="detail-row"><strong>${t('jobDetails.status')}:</strong> ${escapeHtml(
            job.status || ''
          )}</div>
          <div class="detail-row"><strong>${t('jobDetails.progress')}:</strong> ${escapeHtml(
            String(job.progress ?? 0)
          )}%</div>
          <div class="detail-row"><strong>${t('jobDetails.user')}:</strong> ${
            job.user_email ? escapeHtml(job.user_email) : t('common.na')
          }</div>
          <div class="detail-row"><strong>${t('jobDetails.attempts')}:</strong> ${escapeHtml(
            String(job.attempt ?? 0)
          )} / ${escapeHtml(String(job.max_attempts ?? 0))}</div>
          <div class="detail-row"><strong>${t('jobDetails.createdAt')}:</strong> ${escapeHtml(
            formatDateTime(job.created_at)
          )}</div>
          <div class="detail-row"><strong>${t('jobDetails.updatedAt')}:</strong> ${escapeHtml(
            formatDateTime(job.updated_at)
          )}</div>
          <div class="detail-row"><strong>${t('jobDetails.duration')}:</strong> ${escapeHtml(
            String(job.duration ?? '-')
          )}</div>
        </div>
        <div>
          <h4>${t('jobDetails.sectionQueue')}</h4>
          <div class="detail-row"><strong>${t('jobDetails.lockedBy')}:</strong> ${
            job.locked_by ? escapeHtml(job.locked_by) : t('common.na')
          }</div>
          <div class="detail-row"><strong>${t('jobDetails.lockedAt')}:</strong> ${
            job.locked_at ? escapeHtml(formatDateTime(job.locked_at)) : t('common.na')
          }</div>
          <div class="detail-row"><strong>${t('jobDetails.leaseUntil')}:</strong> ${
            job.lease_until ? escapeHtml(formatDateTime(job.lease_until)) : t('common.na')
          }</div>
          <div class="detail-row"><strong>${t('jobDetails.heartbeat')}:</strong> ${
            job.heartbeat_at ? escapeHtml(formatDateTime(job.heartbeat_at)) : t('common.na')
          }</div>
        </div>
      </div>
      <div class="details-block">
        <h4>${t('jobDetails.sectionLinks')}</h4>
        <div class="detail-row"><strong>${t('jobDetails.linksTotal')}:</strong> ${escapeHtml(
          String(job.total_links ?? 0)
        )}</div>
        <div class="detail-row"><strong>${t('jobDetails.linksProcessed')}:</strong> ${escapeHtml(
          String(job.processed_links ?? 0)
        )}</div>
        <div class="detail-row"><strong>${t('jobDetails.linksError')}:</strong> ${escapeHtml(
          String(stats.error ?? 0)
        )}</div>
        <div class="detail-row"><strong>${t('jobDetails.linksPending')}:</strong> ${escapeHtml(
          String(stats.pending ?? 0)
        )}</div>
      </div>
      <div class="details-block">
        <h4>${t('jobDetails.sectionError')}</h4>
        <pre class="details-pre">${escapeHtml(job.error_message || t('common.na'))}</pre>
      </div>
      <div class="details-block">
        <h4>${t('jobDetails.sectionPrompt')}</h4>
        <pre class="details-pre">${escapeHtml(job.prompt || t('common.na'))}</pre>
      </div>
    `;

    openJobDetailsModal();
  } catch (error) {
    showError(t('messages.jobDetailsError', { message: error.message }));
  } finally {
    hideLoading();
  }
}

function openJobDetailsModal() {
  openModal(document.getElementById('job-details-modal'), '#job-details-close');
}

function closeJobDetailsModal() {
  closeModal(document.getElementById('job-details-modal'));
}

function getFocusableElements(modal) {
  return Array.from(modal?.querySelectorAll(FOCUSABLE_SELECTOR) || []).filter(
    (element) => element.offsetParent !== null || element === document.activeElement
  );
}

function trapFocusInModal(e) {
  if (!activeModal || e.key !== 'Tab') return;
  const focusable = getFocusableElements(activeModal);
  if (focusable.length === 0) {
    e.preventDefault();
    activeModal.querySelector('.modal-content')?.focus();
    return;
  }

  e.preventDefault();
  const activeIndex = focusable.indexOf(document.activeElement);
  const fallbackIndex = e.shiftKey ? focusable.length - 1 : 0;
  const nextIndex =
    activeIndex === -1
      ? fallbackIndex
      : (activeIndex + (e.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
  focusable[nextIndex].focus();
}

function openModal(modal, initialFocusSelector = null) {
  if (!modal) return;
  lastFocusedBeforeModal = document.activeElement;
  activeModal = modal;
  modal.classList.add('active');
  modal.addEventListener('keydown', trapFocusInModal);

  window.setTimeout(() => {
    const initialFocus =
      (initialFocusSelector && modal.querySelector(initialFocusSelector)) ||
      getFocusableElements(modal)[0] ||
      modal.querySelector('.modal-content');
    initialFocus?.focus();
  }, 0);
}

function closeModal(modal) {
  if (!modal) return;
  modal.classList.remove('active');
  modal.removeEventListener('keydown', trapFocusInModal);
  if (activeModal === modal) activeModal = null;
  if (lastFocusedBeforeModal && document.contains(lastFocusedBeforeModal)) {
    lastFocusedBeforeModal.focus();
  }
  lastFocusedBeforeModal = null;
}

function setupTableActionHandlers() {
  const usersTable = document.getElementById('users-table-body');
  if (usersTable) {
    usersTable.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      const userId = btn.getAttribute('data-user-id');
      const userEmail = btn.getAttribute('data-user-email') || '';
      if (!action || !userId) return;
      if (action === 'make-admin') makeAdmin(userId);
      if (action === 'revoke-admin') revokeAdmin(userId);
      if (action === 'delete-user') deleteUser(userId, userEmail);
    });
  }

  const jobsTable = document.getElementById('jobs-table-body');
  if (jobsTable) {
    jobsTable.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      const jobId = btn.getAttribute('data-job-id');
      if (!action || !jobId) return;
      if (action === 'view-report') viewJobReport(jobId);
      if (action === 'retry-job') retryJob(jobId);
      if (action === 'delete-job') deleteJob(jobId);
      if (action === 'job-details') showJobDetails(jobId);
      if (action === 'edit-job-title') {
        const encodedTitle = btn.getAttribute('data-job-title') || '';
        const currentTitle = decodeURIComponent(encodedTitle);
        editJobTitle(jobId, currentTitle);
      }
    });
  }

  const workersTable = document.getElementById('workers-table-body');
  if (workersTable) {
    workersTable.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action="terminate-worker"]');
      if (!btn) return;
      const jobId = btn.getAttribute('data-job-id');
      if (!jobId) return;
      terminateWorker(jobId);
    });
  }
}

function setupPaginationHandlers() {
  const paginationConfigs = [
    { id: 'users-pagination', type: 'users' },
    { id: 'jobs-pagination', type: 'jobs' },
    { id: 'audit-pagination', type: 'audit' },
  ];

  paginationConfigs.forEach(({ id, type }) => {
    const container = document.getElementById(id);
    if (!container) return;
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-page]');
      if (!btn || btn.disabled) return;
      const page = Number.parseInt(btn.getAttribute('data-page') || '0', 10);
      if (!page || Number.isNaN(page) || page < 1) return;
      changePage(type, page);
    });
  });
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
  if (!confirmWithKeyword(t('confirm.deleteUser', { email }), 'DELETE', t('confirm.typeDelete')))
    return;

  try {
    await apiCall(`/api/admin/users/${userId}`, 'DELETE');
    showSuccess(t('messages.userDeleted'));
    await loadUsers();
  } catch (error) {
    showError(t('messages.userDeleteError', { message: error.message }));
  }
}

async function deleteJob(jobId) {
  if (!confirmWithKeyword(t('confirm.deleteJob'), 'DELETE', t('confirm.typeDelete'))) return;

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
  const reportUrl = `/admin/report.html?jobId=${jobId}`;
  // NOTE: intentionally NOT using 'noopener'. The report page reads the admin
  // token from sessionStorage, which is session-scoped (kept out of localStorage
  // for security). A 'noopener' tab gets a fresh, EMPTY sessionStorage, so the
  // report page would find no token and bounce to /admin. Opening as a normal
  // same-origin tab lets it inherit the session token (and report.js severs the
  // opener link immediately after, so there is no reverse-tabnabbing exposure).
  window.open(reportUrl, '_blank');
}

async function performCleanup(type) {
  const confirmMessages = {
    old_jobs: t('confirm.cleanupOldJobs'),
    failed_jobs: t('confirm.cleanupFailedJobs'),
    old_cache: t('confirm.cleanupOldCache'),
  };

  if (
    !confirmWithKeyword(
      confirmMessages[type] || t('confirm.cleanupOldJobs'),
      'CLEAN',
      t('confirm.typeCleanup')
    )
  )
    return;

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
    logout({ reason: t('messages.sessionExpired') });
    throw new Error(t('messages.sessionExpired'));
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const message =
      response.status >= 500 ? t('messages.serverError') : error.error || 'API request failed';
    throw new Error(message);
  }

  const data = await response.json();
  recordActivity();
  return data;
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
  html += `<button ${page <= 1 ? 'disabled' : ''} data-page="${page - 1}" aria-label="${t('common.previousPage')}">
                <i class="fas fa-chevron-left"></i>
             </button>`;

  // Page numbers
  for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) {
    html += `<button class="${i === page ? 'active' : ''}" data-page="${i}" aria-label="${t('common.pageLabel', { page: i })}" ${i === page ? 'aria-current="page"' : ''}>
                    ${i}
                 </button>`;
  }

  // Next button
  html += `<button ${page >= totalPages ? 'disabled' : ''} data-page="${page + 1}" aria-label="${t('common.nextPage')}">
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
  openModal(document.getElementById('login-modal'), '#email');
}

function hideLoginModal() {
  closeModal(document.getElementById('login-modal'));
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
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
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

function confirmWithKeyword(message, keyword, promptMessage) {
  if (!confirm(message)) return false;
  const typed = prompt(promptMessage);
  if (!typed || typed.trim().toUpperCase() !== keyword) {
    showError(t('messages.confirmFailed'));
    return false;
  }
  return true;
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
