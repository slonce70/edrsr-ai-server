// Initialize results page after DOM and marked.js are ready
function loadResultsScript() {
  const script = document.createElement('script');
  script.src = 'results.js';
  script.onerror = () => console.error('Failed to load results.js');
  document.head.appendChild(script);
}

function waitForMarked() {
  if (typeof marked !== 'undefined') {
    loadResultsScript();
    return;
  }

  // Оптимизированная проверка с экспоненциальным backoff
  let attempts = 0;
  const maxAttempts = 20; // Reduced attempts

  function checkMarked() {
    attempts++;
    if (typeof marked !== 'undefined') {
      loadResultsScript();
      return;
    }

    if (attempts >= maxAttempts) {
      console.warn('Marked.js not found, loading results.js anyway');
      loadResultsScript();
      return;
    }

    // Exponential backoff: 50ms, 100ms, 200ms, 400ms...
    const delay = Math.min(50 * Math.pow(2, attempts - 1), 500);
    setTimeout(checkMarked, delay);
  }

  checkMarked();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', waitForMarked);
} else {
  waitForMarked();
}
