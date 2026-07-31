// Background service worker for PII Sanitizer extension

// Check if local server is reachable
async function checkServerHealth() {
  try {
    const response = await fetch('http://localhost:8787/sanitize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'health_check' }),
      signal: AbortSignal.timeout(2000) // 2 second timeout
    });
    const isOk = response.ok;
    updateBadge(isOk);
    return isOk;
  } catch (error) {
    updateBadge(false);
    return false;
  }
}

function updateBadge(isHealthy) {
  if (!isHealthy) {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
    chrome.action.setTitle({
      title: 'PII Sanitizer - Server unreachable! localhost:8787 is not running.'
    });
  } else {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'PII Sanitizer - Active' });
  }
}

// Check server health on extension startup and periodically
checkServerHealth();
setInterval(checkServerHealth, 30000); // Check every 30 seconds

// Listen for content script health checks
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkServerHealth') {
    checkServerHealth().then(isHealthy => sendResponse({ isHealthy }));
    return true; // Keep message channel open for async response
  }
});