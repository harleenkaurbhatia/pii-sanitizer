// Popup script for PII Sanitizer extension

const sanitizeToggle = document.getElementById('sanitizeToggle');
const statusMessage = document.getElementById('statusMessage');
const serverStatus = document.getElementById('serverStatus');

// Load saved state
function loadState() {
  chrome.storage.local.get(['piiSanitizerEnabled'], (result) => {
    const isEnabled = result.piiSanitizerEnabled !== false; // Default to true
    sanitizeToggle.checked = isEnabled;
    updateStatusMessage(isEnabled);
  });
  checkServerHealth();
}

// Update status message
function updateStatusMessage(isEnabled) {
  if (isEnabled) {
    statusMessage.textContent = 'PII sanitization is active. Your messages will be sent to the local server before submission.';
    statusMessage.className = 'status success';
  } else {
    statusMessage.textContent = 'PII sanitization is disabled. Messages will be sent as-is.';
    statusMessage.className = 'status';
  }
}

// Check server health
async function checkServerHealth() {
  serverStatus.textContent = 'Checking server...';
  serverStatus.className = 'server-status checking';

  try {
    const response = await fetch('http://localhost:8787/sanitize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'health_check' }),
      signal: AbortSignal.timeout(2000)
    });

    if (response.ok) {
      serverStatus.textContent = '✓ Local server connected (localhost:8787)';
      serverStatus.className = 'server-status online';
    } else {
      throw new Error(`Server returned ${response.status}`);
    }
  } catch (error) {
    serverStatus.textContent = '✗ Local server unreachable - Start with: python -m uvicorn main:app --reload';
    serverStatus.className = 'server-status offline';
  }
}

// Toggle handler
sanitizeToggle.addEventListener('change', (event) => {
  const isEnabled = event.target.checked;
  chrome.storage.local.set({ piiSanitizerEnabled: isEnabled }, () => {
    updateStatusMessage(isEnabled);
  });
});

// Initialize
loadState();