// Background service worker - v2 - Simple version
console.log('🧪 PII Sanitizer: Background service worker v2 loaded');

const TRANSCRIPT_KEY = 'piiSanitizerTranscript';
const MAX_TRANSCRIPT_ENTRIES = 500;

// Listen for sanitization requests from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('📨 Background: Received message:', request.action);

  if (request.action === 'sanitize') {
    handleSanitization(request.text, sendResponse);
  }

  if (request.action === 'testExtension') {
    const isReady = typeof chrome !== 'undefined' && chrome.runtime && chrome.storage;
    sendResponse({ isReady, chromeAPI: typeof chrome !== 'undefined', storageAPI: typeof chrome?.storage?.local?.get === 'function' });
  }

  if (request.action === 'testServer') {
    testServerConnection(sendResponse);
  }

  if (request.action === 'saveTranscriptEntry') {
    saveTranscriptEntry(request.site, request.original, request.sanitized, sendResponse);
    return true;
  }

  if (request.action === 'getTranscript') {
    chrome.storage.local.get([TRANSCRIPT_KEY], (result) => {
      sendResponse({ transcript: result[TRANSCRIPT_KEY] || [] });
    });
    return true;
  }

  if (request.action === 'clearTranscript') {
    chrome.storage.local.set({ [TRANSCRIPT_KEY]: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

function saveTranscriptEntry(site, original, sanitized, sendResponse) {
  chrome.storage.local.get(['piiSanitizerSaveTranscript', TRANSCRIPT_KEY], (result) => {
    const saveEnabled = result.piiSanitizerSaveTranscript !== false;

    if (!saveEnabled) {
      sendResponse({ success: false, reason: 'disabled' });
      return;
    }

    const transcript = result[TRANSCRIPT_KEY] || [];
    transcript.push({
      timestamp: new Date().toISOString(),
      site,
      original,
      sanitized
    });

    while (transcript.length > MAX_TRANSCRIPT_ENTRIES) {
      transcript.shift();
    }

    chrome.storage.local.set({ [TRANSCRIPT_KEY]: transcript }, () => {
      sendResponse({ success: true, count: transcript.length });
    });
  });
}

async function handleSanitization(text, sendResponse) {
  console.log('🔄 Processing sanitization request for:', text.substring(0, 50));

  try {
    const response = await fetch('http://localhost:8787/sanitize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text }),
      signal: AbortSignal.timeout(3000)
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ Sanitization successful:', data.sanitized.substring(0, 50));
      sendResponse({ success: true, sanitized: data.sanitized });
    } else {
      console.error('❌ Server responded with:', response.status);
      sendResponse({ success: false, sanitized: text });
    }

  } catch (error) {
    console.error('❌ Background fetch error:', error.message);
    console.log('⚠️  Sending original text');
    sendResponse({ success: false, sanitized: text });
  }
}

function testServerConnection(sendResponse) {
  console.log('🔍 Testing server connection...');

  fetch('http://localhost:8787/sanitize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'test-connection' }),
    signal: AbortSignal.timeout(3000)
  })
  .then(response => response.json().then(data => ({ ok: response.ok, data })))
  .then(({ ok, data }) => {
    const isHealthy = ok && typeof data.sanitized === 'string';
    console.log('🔍 Server health check:', isHealthy);

    if (isHealthy) {
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
      chrome.action.setTitle({ title: 'PII Sanitizer - Active' });
    } else {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
      chrome.action.setTitle({ title: 'PII Sanitizer - Server unreachable' });
    }

    if (sendResponse) sendResponse({ isHealthy, response: data });
  })
  .catch(error => {
    console.error('❌ Server health check error:', error.message);
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
    chrome.action.setTitle({ title: 'PII Sanitizer - Server unreachable' });
    if (sendResponse) sendResponse({ isHealthy: false, error: error.message });
  });
}

// Test server connectivity periodically
setInterval(testServerConnection, 5000);

console.log('✅ Background service v2 initialized');
console.log('🎯 Architecture: Content script → Background → Server → Sanitize → Send back');
console.log('🔧 Simplified to work across all Chrome contexts');