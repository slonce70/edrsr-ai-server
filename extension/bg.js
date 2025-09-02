// --- EDRSR-AI Service Worker v2.1 ---
// This service worker uses a modern, robust architecture with WebSockets
// and long-lived port connections to ensure reliability and prevent termination.
import { API_BASE_URL, WS_URL } from './config.js';
import { getAccessToken, isAuthenticated, forceRefresh } from './auth.js';

let socket = null;
let popupPort = null;
let resultsPort = null;
let heartbeatInterval = null;
const jobToTabMap = new Map();
let reconnectAttempts = 0;
let clientId = null;
const CURRENT_VERSION = '2.2'; // Версия, которую мы ожидаем от content.js
// Session-level visited URLs to avoid re-sending in current runtime
const sessionVisited = new Set();

// --- WebSocket Connection Management ---

function startHeartbeat() {
  clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'heartbeat' }));
      console.log('[WS] Sent heartbeat.');
    }
  }, 20000); // Send heartbeat every 20 seconds
}

function stopHeartbeat() {
  clearInterval(heartbeatInterval);
  heartbeatInterval = null;
}

function connectWebSocket() {
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    console.log('[WS] WebSocket is already open or connecting.');
    if (popupPort)
      popupPort.postMessage({ type: 'WEBSOCKET_STATUS', payload: { status: 'connected' } });
    reconnectAttempts = 0; // Reset counter on successful connection or attempt
    return;
  }

  console.log(`[WS] Connecting to server... (Attempt: ${reconnectAttempts + 1})`);
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    console.log('[WS] Connection established.');
    reconnectAttempts = 0; // Reset counter on successful connection
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
    chrome.action.setBadgeText({ text: '✓' });
    if (popupPort)
      popupPort.postMessage({ type: 'WEBSOCKET_STATUS', payload: { status: 'connected' } });
    startHeartbeat();
    // Authenticate WS with current token if available
    (async () => {
      const token = await getAccessToken();
      if (token) {
        socket.send(JSON.stringify({ type: 'auth', token }));
      }
    })();
  };

  socket.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);
      console.log('[WS] Received message:', message);

      if (message.type === 'JOB_UPDATE') {
        let jobData = message.payload;
        try {
          if (jobData && jobData.id && jobData.status === 'completed' && !jobData.analysis) {
            const res = await apiFetch(`${API_BASE_URL}/jobs/${jobData.id}/analysis`);
            if (res.ok) {
              const { analysis } = await res.json();
              if (analysis) jobData = { ...jobData, analysis };
            }
          }
        } catch (_e) {
          // best-effort enrichment; ignore fetch errors here
        }
        const storageKey = `job_status_${jobData.id}`;

        // Get the previous state BEFORE updating storage and the badge
        const oldData = await chrome.storage.local.get(storageKey);
        const oldStatus = oldData[storageKey]?.status;

        // Create a "light" version for storage to avoid exceeding quota.
        const { analysis, links, ...jobDataForStorage } = jobData;

        // Store the latest light status
        chrome.storage.local.set({ [storageKey]: jobDataForStorage });

        // Send the full update to any connected ports
        if (popupPort) {
          popupPort.postMessage({ type: 'JOB_UPDATE', payload: jobData });
        }
        if (resultsPort && resultsPort.jobId === jobData.id) {
          resultsPort.postMessage({ type: 'JOB_UPDATE', payload: jobData });
        }
        updateBadge(jobData, oldStatus); // Pass old status
      } else if (message.type === 'clientId') {
        clientId = message.payload;
        console.log(`[WS] Received clientId: ${clientId}`);
      } else if (message.type === 'job_title_updated') {
        // This is a specific event from the server after a PATCH request
        const jobData = message.payload;

        // Create a "light" version for storage
        const { analysis, links, ...jobDataForStorage } = jobData;
        chrome.storage.local.set({ [`job_status_${jobData.id}`]: jobDataForStorage });

        // Create a standard JOB_UPDATE message to broadcast
        const updateMessage = { type: 'JOB_UPDATE', payload: jobData };

        // Send the update to both popup and results ports if they are connected
        if (popupPort) {
          popupPort.postMessage(updateMessage);
        }
        if (resultsPort && resultsPort.jobId === jobData.id) {
          resultsPort.postMessage(updateMessage);
        }

        // Also update the badge
        updateBadge(jobData);
      }
    } catch (error) {
      console.error('[WS] Error processing message:', error);
    }
  };

  socket.onclose = (event) => {
    console.log(`[WS] Connection closed. Code: ${event.code}, Reason: ${event.reason}`);
    chrome.action.setBadgeBackgroundColor({ color: '#F44336' }); // Red for disconnected
    chrome.action.setBadgeText({ text: 'OFF' }); // Use 'OFF' to indicate disconnected state
    if (popupPort)
      popupPort.postMessage({ type: 'WEBSOCKET_STATUS', payload: { status: 'disconnected' } });
    socket = null;
    stopHeartbeat();

    // Only attempt to reconnect if the closure was abnormal (e.g., server went down)
    // A normal closure (code 1000) means we don't need to reconnect.
    if (event.code !== 1000) {
      reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 60000); // Max 1 minute
      console.log(`[WS] Next reconnect attempt in ${delay / 1000} seconds.`);
      if (popupPort)
        popupPort.postMessage({ type: 'WEBSOCKET_STATUS', payload: { status: 'reconnecting' } });
      setTimeout(connectWebSocket, delay);
    } else {
      console.log('[WS] WebSocket closed normally. No reconnection needed.');
    }
  };

  socket.onerror = (errorEvent) => {
    console.error(
      `[WS] WebSocket error occurred. Type: ${errorEvent.type}. More details in the following event.`
    );
    // Set a visual indicator that an error has happened before the connection closes.
    chrome.action.setBadgeBackgroundColor({ color: '#F44336' }); // Red for error
    chrome.action.setBadgeText({ text: 'ERR' });
    // The 'onclose' event will be fired immediately after this,
    // which will handle the full "disconnected" state and reconnection logic.
  };
}

// --- Badge and Notification Management ---

async function updateBadge(job, oldStatus = null) {
  if (!job) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  const statusColors = {
    queued: '#9E9E9E',
    downloading: '#2196F3',
    analyzing: '#9C27B0',
    completed: '#4CAF50',
    error: '#F44336',
  };
  chrome.action.setBadgeBackgroundColor({ color: statusColors[job.status] || '#FF9800' });

  let badgeText = '';
  // Only show notification if the status just changed to 'completed'
  if (job.status === 'completed' && oldStatus !== 'completed') {
    badgeText = '✓';
    showNotification(
      '🎉 Анализ завершён!',
      `Задание ${job.id.substring(0, 8)}... успешно завершено.`
    );
    // Notify the specific tab that its job is complete
    const tabId = jobToTabMap.get(job.id);
    if (tabId) {
      chrome.tabs
        .sendMessage(tabId, {
          type: 'JOB_COMPLETED',
          payload: { jobId: job.id },
        })
        .catch((e) => console.log(`Could not send completion message to tab ${tabId}.`, e));
      jobToTabMap.delete(job.id); // Clean up the map
    }
  } else if (job.status === 'completed') {
    badgeText = '✓'; // Still show the checkmark, just no notification
  } else if (job.status === 'error' && oldStatus !== 'error') {
    badgeText = '❌';
    showNotification(
      '❌ Ошибка анализа',
      `Задание ${job.id.substring(0, 8)}... завершилось с ошибкой.`
    );
  } else if (job.status === 'error') {
    badgeText = '❌';
  } else {
    badgeText = job.progress ? `${job.progress}%`.slice(0, 3) : '...';
  }
  chrome.action.setBadgeText({ text: badgeText });
}

function showNotification(title, message) {
  chrome.notifications.create(`notif-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icon128.png',
    title,
    message,
    priority: 2,
  });
}

// --- Long-Lived Port Connection Management ---

chrome.runtime.onConnect.addListener((port) => {
  const portHandler = (message) => {
    handlePortMessage(message, port);
  };

  if (port.name === 'popup') {
    popupPort = port;
    console.log('[PORT] Popup connected.');

    // Immediately send the current status upon connection
    const currentStatus =
      socket && socket.readyState === WebSocket.OPEN ? 'connected' : 'disconnected';
    popupPort.postMessage({ type: 'WEBSOCKET_STATUS', payload: { status: currentStatus } });

    port.onMessage.addListener(portHandler);
    port.onDisconnect.addListener(() => {
      console.log('[PORT] Popup disconnected.');
      port.onMessage.removeListener(portHandler);
      popupPort = null;
    });
  } else if (port.name === 'results') {
    resultsPort = port;
    console.log('[PORT] Results page connected.');
    port.onMessage.addListener(portHandler);
    port.onDisconnect.addListener(() => {
      console.log('[PORT] Results page disconnected.');
      port.onMessage.removeListener(portHandler);
      resultsPort = null;
    });
  }
});

// --- Message Handling Logic ---

async function handlePortMessage(message, port, sendResponse) {
  const { type, payload } = message;

  try {
    switch (type) {
      case 'AUTH_CHANGED': {
        // Forward fresh token to WS if connected
        if (socket && socket.readyState === WebSocket.OPEN) {
          const token = await getAccessToken();
          if (token) socket.send(JSON.stringify({ type: 'auth', token }));
        }
        break;
      }
      case 'START_JOB': {
        // Ensure the user is authenticated when called from content script (no popupPort)
        const authed = await isAuthenticated();
        if (!authed) {
          const msg = 'Требуется вход. Откройте попап расширения и выполните вход.';
          if (popupPort) {
            popupPort.postMessage({ type: 'AUTH_REQUIRED' });
          }
          if (port) {
            port.postMessage({ type: 'ERROR', payload: { message: msg } });
          } else if (typeof sendResponse === 'function') {
            sendResponse({ success: false, error: msg });
          }
          return;
        }
        // Version Handshake
        let version = '';
        try {
          version = await chrome.tabs.sendMessage(payload.tabId, { type: 'GET_VERSION' });
        } catch (e) {
          // Content script is likely old and doesn't have the listener.
          console.error('Error getting version from content script:', e.message);
        }

        if (version !== CURRENT_VERSION) {
          throw new Error(
            `Версия скрипта на странице устарела. Пожалуйста, полностью обновите страницу (Ctrl+F5) и попробуйте снова.`
          );
        }

        // Optional filters (server-side safety net)
        let linksToSend = payload.links || [];
        try {
          // Filter by user history if requested
          if (payload.uniqueOnly === true) {
            const res = await apiFetch(`${API_BASE_URL}/processed-urls`);
            const data = await res.json();
            if (res.ok && data?.success && Array.isArray(data.urls)) {
              const processed = new Set(data.urls);
              linksToSend = linksToSend.filter((l) => l && l.url && !processed.has(l.url));
            }
          }
          // Filter by session visited if requested
          if (payload.ignoreSessionVisited === true) {
            linksToSend = linksToSend.filter((l) => l && l.url && !sessionVisited.has(l.url));
          }
        } catch (_e) {
          // intentionally ignore optional filtering errors to keep UX smooth
          void 0;
        }

        if (!Array.isArray(linksToSend) || linksToSend.length === 0) {
          throw new Error('Нет дел для отправки на анализ с выбранными фильтрами.');
        }

        const response = await apiFetch(`${API_BASE_URL}/collect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            links: linksToSend,
            cookie: payload.cookie,
            prompt: payload.prompt,
            prompt_label: payload.promptLabel || null,
            auto_title_enabled: payload.autoTitleEnabled !== false,
            clientId,
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Server error');

        // Mark as visited in this session to avoid repeat submits
        try {
          linksToSend.forEach((l) => l?.url && sessionVisited.add(l.url));
        } catch (_e) {
          // ignore sessionVisited cache issues
          void 0;
        }

        // Inform the content script which job to track
        if (result.jobId && payload.tabId) {
          jobToTabMap.set(result.jobId, payload.tabId); // Store the tabId for this job
          chrome.tabs
            .sendMessage(payload.tabId, {
              type: 'SET_TRACKING_JOB',
              payload: { jobId: result.jobId },
            })
            .catch((e) =>
              console.log(`Could not inform content script on tab ${payload.tabId}.`, e)
            );
        }

        // Respond to the sender (either port or direct message)
        const responseMessage = { success: true, jobId: result.jobId };
        if (port) {
          port.postMessage({ type: 'JOB_STARTED_SUCCESS', payload: result });
        } else {
          sendResponse(responseMessage);
        }

        // Manually trigger first update for the popup
        if (popupPort && result.job) {
          popupPort.postMessage({ type: 'JOB_UPDATE', payload: result.job });
        }
        return;
      }
      case 'API_GET_SESSION_VISITED': {
        const urls = Array.from(sessionVisited);
        if (port) port.postMessage({ type: 'SESSION_VISITED', payload: { urls } });
        else sendResponse({ success: true, urls });
        return;
      }
      case 'GET_JOB_STATUS': {
        const { jobId } = payload;
        // Always fetch the latest status from the server when explicitly requested.
        try {
          console.log(`[BG] Fetching latest status for job ${jobId} from server...`);

          // Get the previous state BEFORE fetching new data
          const storageKey = `job_status_${jobId}`;
          const oldData = await chrome.storage.local.get(storageKey);
          const oldStatus = oldData[storageKey]?.status;

          const response = await apiFetch(`${API_BASE_URL}/status/${jobId}?light=true`);
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP ${response.status}`);
          }
          const jobData = await response.json();

          // Send the full, fresh data back to the popup.
          port.postMessage({ type: 'JOB_UPDATE', payload: jobData });

          // Also, update the badge to reflect the status of the job being viewed.
          // Pass the old status to prevent unwanted notifications.
          updateBadge(jobData, oldStatus);

          // Also, update the local storage with this fresh data.
          const { analysis, links, ...jobDataForStorage } = jobData;
          await chrome.storage.local.set({ [storageKey]: jobDataForStorage });
        } catch (error) {
          console.error(`[BG] Failed to fetch job status for ${jobId}:`, error);
          port.postMessage({
            type: 'ERROR',
            payload: { message: `Не удалось загрузить статус задания: ${error.message}` },
          });
        }
        break;
      }
      case 'GET_JOB_FOR_RESULTS_PAGE': {
        const { jobId } = payload;
        if (port.name === 'results') {
          port.jobId = jobId; // Associate port with a job ID
        }

        // Subscribe to future updates
        if (socket && socket.readyState === WebSocket.OPEN) {
          const token = await getAccessToken();
          if (token) socket.send(JSON.stringify({ type: 'auth', token }));
          socket.send(JSON.stringify({ type: 'subscribe', jobId }));
        }

        const storageKey = `job_status_${jobId}`;
        const localData = await chrome.storage.local.get(storageKey);

        // Immediately send local data if available to show *something* initially.
        if (localData[storageKey]) {
          console.log(
            `[BG] Sending cached job data for ${jobId} to results page for initial render.`
          );
          port.postMessage({ type: 'JOB_UPDATE', payload: localData[storageKey] });
          // But we don't stop here, we always fetch the full data for the results page.
        }

        // Fetch latest light job and analysis separately to reduce payload
        console.log(`[BG] Fetching latest light job data and analysis for ${jobId}...`);
        try {
          const [lightRes, analRes] = await Promise.all([
            apiFetch(`${API_BASE_URL}/status/${jobId}?light=true`),
            apiFetch(`${API_BASE_URL}/jobs/${jobId}/analysis`),
          ]);
          if (!lightRes.ok) {
            const errorData = await lightRes.json();
            throw new Error(errorData.error || `HTTP ${lightRes.status}`);
          }
          const lightJob = await lightRes.json();
          let analysis = null;
          try {
            if (analRes.ok) {
              const analJson = await analRes.json();
              analysis = analJson.analysis || null;
            }
          } catch (_e) {
            // analysis may be absent while job is still in progress; ignore
          }

          const jobData = analysis ? { ...lightJob, analysis } : lightJob;

          // Send to the results page
          port.postMessage({ type: 'JOB_UPDATE', payload: jobData });

          // Store light version for badge/popup
          const { analysis: _a, links, ...jobDataForStorage } = jobData;
          await chrome.storage.local.set({ [storageKey]: jobDataForStorage });
        } catch (error) {
          console.error(`[BG] Failed to fetch job status for ${jobId}:`, error);
          port.postMessage({
            type: 'ERROR',
            payload: { message: `Не удалось загрузить данные задания: ${error.message}` },
          });
        }
        break;
      }
      case 'GET_LAST_JOB': {
        const allStorage = await chrome.storage.local.get(null);
        const allJobs = Object.entries(allStorage)
          .filter(([key]) => key.startsWith('job_status_'))
          .map(([, value]) => value)
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        if (port && allJobs.length > 0) {
          port.postMessage({ type: 'JOB_UPDATE', payload: allJobs[0] });
        }
        break;
      }
      case 'GET_HISTORY': {
        const response = await apiFetch(`${API_BASE_URL}/jobs?limit=all`);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Server error');
        if (port) {
          port.postMessage({ type: 'HISTORY_UPDATE', payload: result.jobs });
        }
        break;
      }
      case 'RETRY_JOB': {
        const { jobId } = payload;
        console.log(`[BG] Received retry request for job: ${jobId}`);
        const response = await apiFetch(`${API_BASE_URL}/retry/${jobId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Server error on retry');

        // The server will have created a NEW job. We need to let the popup/results page know.
        // We can treat this like a new job was started.
        if (popupPort) {
          popupPort.postMessage({ type: 'JOB_STARTED_SUCCESS', payload: result });
          if (result.job) {
            popupPort.postMessage({ type: 'JOB_UPDATE', payload: result.job });
          }
        }
        // If the results page is still open for the OLD job, we need to redirect it.
        // Or, more simply, we can just update its view to the new job's status.
        if (resultsPort && resultsPort.jobId === jobId) {
          // The results page is still looking at the old, failed job.
          // Let's redirect the user to the new job's results page.
          const newJobId = result.jobId;
          const resultsPageUrl = chrome.runtime.getURL(`results.html?jobId=${newJobId}`);
          port.postMessage({ type: 'REDIRECT', payload: { url: resultsPageUrl } });
        }
        break;
      }
      case 'UPDATE_JOB_TITLE': {
        const { jobId, title } = payload;
        try {
          const storageKey = `job_status_${jobId}`;

          // Fetch current status to get oldStatus
          const statusResponse = await apiFetch(`${API_BASE_URL}/status/${jobId}?light=true`);
          if (!statusResponse.ok) {
            const errorData = await statusResponse.json();
            throw new Error(
              errorData.error || `Failed to fetch status: HTTP ${statusResponse.status}`
            );
          }
          const oldJob = await statusResponse.json();
          const oldStatus = oldJob.status;

          // Store light version in local storage
          const oldDataForStorage = (({ analysis, links, ...o }) => o)(oldJob);
          await chrome.storage.local.set({ [storageKey]: oldDataForStorage });

          // Now update title
          const response = await apiFetch(`${API_BASE_URL}/jobs/${jobId}/title`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title }),
          });
          const result = await response.json();
          if (!response.ok) {
            throw new Error(result.error || 'Server error');
          }

          console.log(`[BG] Successfully updated title for job ${jobId}. Broadcasting update.`);

          const updateMessage = { type: 'JOB_UPDATE', payload: result.job };
          if (popupPort) {
            popupPort.postMessage(updateMessage);
          }
          if (resultsPort && resultsPort.jobId === jobId) {
            resultsPort.postMessage(updateMessage);
          }

          updateBadge(result.job, oldStatus);

          const jobDataForStorage = (({ analysis, links, ...o }) => o)(result.job);
          await chrome.storage.local.set({ [storageKey]: jobDataForStorage });
        } catch (error) {
          console.error(`[BG] Failed to update title for job ${jobId}:`, error);
          port.postMessage({
            type: 'ERROR',
            payload: { message: `Не вдалося оновити назву: ${error.message}` },
          });
        }
        break;
      }
      case 'DELETE_JOB': {
        const { jobId } = payload;
        const response = await apiFetch(`${API_BASE_URL}/jobs/${jobId}`, {
          method: 'DELETE',
        });
        if (!response.ok) {
          const result = await response.json();
          throw new Error(result.error || `Failed to delete job ${jobId}`);
        }
        // Refresh the history list in the popup
        if (popupPort) {
          const historyResponse = await apiFetch(`${API_BASE_URL}/jobs?limit=all`);
          const historyResult = await historyResponse.json();
          if (historyResponse.ok) {
            popupPort.postMessage({ type: 'HISTORY_UPDATE', payload: historyResult.jobs });
          }
        }
        break;
      }
      case 'GET_CHAT_HISTORY': {
        const { jobId } = payload;
        const response = await apiFetch(`${API_BASE_URL}/chat/${jobId}`);
        const history = await response.json();
        if (port) {
          port.postMessage({ type: 'CHAT_UPDATE', payload: history });
        }
        break;
      }
      case 'SEND_CHAT_MESSAGE': {
        const { jobId, message } = payload;
        const response = await apiFetch(`${API_BASE_URL}/chat/${jobId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Server error');
        // After sending, get the full updated history and send it back
        const historyResponse = await apiFetch(`${API_BASE_URL}/chat/${jobId}`);
        const history = await historyResponse.json();
        if (port) {
          port.postMessage({ type: 'CHAT_UPDATE', payload: history });
        }
        break;
      }
      case 'GET_LINKS_CONTENT': {
        const { jobId } = payload;
        try {
          const res = await apiFetch(`${API_BASE_URL}/jobs/${jobId}/links-content`);
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
          if (port) port.postMessage({ type: 'LINKS_CONTENT', payload: json });
        } catch (error) {
          if (port) port.postMessage({ type: 'ERROR', payload: { message: error.message } });
        }
        break;
      }
      case 'GET_CLIENT_ID': {
        if (port) {
          port.postMessage({ type: 'CLIENT_ID', payload: clientId });
        } else {
          sendResponse(clientId);
        }
        return;
      }
      case 'GET_ACTIVE_TAB': {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          sendResponse(tabs[0]);
        });
        return true;
      }
    }
  } catch (error) {
    console.error(`[HANDLER] Error processing ${type}:`, error);
    if (port) {
      port.postMessage({ type: 'ERROR', payload: { message: error.message } });
    } else if (typeof sendResponse === 'function') {
      try {
        sendResponse({ success: false, error: error.message });
      } catch (_e) {
        // ignore sendResponse errors
      }
    }
  }
}

// --- Add listener for direct messages from content script ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_ACTIVE_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      sendResponse(tabs[0]);
    });
    return true;
  }
  if (message.type === 'GET_API_URL') {
    sendResponse(API_BASE_URL);
    return true;
  }
  if (message.type === 'GET_VERSION') {
    sendResponse(CURRENT_VERSION);
    return true;
  }
  if (message.type === 'API_GET_PROCESSED_URLS') {
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE_URL}/processed-urls`);
        const data = await res.json();
        sendResponse(data);
      } catch (e) {
        // If user is not authenticated, degrade gracefully with empty list
        if (String(e?.message || '') === 'Authentication required') {
          sendResponse({ success: true, urls: [] });
        } else {
          sendResponse({ success: false, error: e.message });
        }
      }
    })();
    return true; // keep channel open for async response
  }
  if (message.type === 'API_CHECK_PROCESSED') {
    (async () => {
      try {
        const urls = Array.isArray(message.urls) ? message.urls.filter(Boolean) : [];
        const res = await apiFetch(`${API_BASE_URL}/urls/processed-check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        // Backward-compatible shape: return as { urls }
        sendResponse({ success: true, urls: data.processed || [] });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
  // Handle other messages
  if (message.type === 'START_JOB' || message.type === 'GET_CLIENT_ID') {
    handlePortMessage(message, null, sendResponse);
    return true;
  }
});

// --- Initial Setup ---
connectWebSocket();
async function apiFetch(path, init = {}) {
  const attempt = async (token) => {
    const headers = Object.assign({}, init.headers || {}, {
      Authorization: `Bearer ${token}`,
    });
    return fetch(path, { ...init, headers });
  };

  let token = await getAccessToken();
  if (!token) {
    if (popupPort) popupPort.postMessage({ type: 'AUTH_REQUIRED' });
    throw new Error('Authentication required');
  }

  let res = await attempt(token);
  if (res.status === 401 || res.status === 403) {
    // Force refresh and retry once
    const newSession = await forceRefresh();
    if (newSession?.access_token) {
      token = newSession.access_token;
      // Re-authenticate WebSocket with the new token if connected
      if (socket && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify({ type: 'auth', token }));
        } catch (_e) {
          // best-effort WS re-auth; ignore transient failures
          void 0;
        }
      }
      res = await attempt(token);
    }
  }

  if (res.status === 401 || res.status === 403) {
    if (popupPort) popupPort.postMessage({ type: 'AUTH_REQUIRED' });
  }

  return res;
}
