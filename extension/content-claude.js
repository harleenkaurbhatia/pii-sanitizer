// Content script for Claude.ai - intercepts messages before they're sent

(function() {
  'use strict';

  let isEnabled = true;
  let sanitizeServerHealthy = true;

  // Check if extension is enabled from storage
  function loadEnabledState() {
    chrome.storage.local.get(['piiSanitizerEnabled'], (result) => {
      isEnabled = result.piiSanitizerEnabled !== false; // Default to true
    });
  }

  // Sanitize text by calling local server
  async function sanitizeText(text) {
    if (!isEnabled || !sanitizeServerHealthy) {
      return text;
    }

    try {
      const response = await fetch('http://localhost:8787/sanitize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text }),
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      if (!response.ok) {
        console.error('PII Sanitizer: Server returned error', response.status);
        return text;
      }

      const data = await response.json();
      return data.sanitized || text;
    } catch (error) {
      console.error('PII Sanitizer: Failed to sanitize text', error);
      sanitizeServerHealthy = false;
      // Notify background to show error badge
      chrome.runtime.sendMessage({ action: 'checkServerHealth' });
      return text;
    }
  }

  // Find the chat input element on Claude.ai
  // Claude.ai uses a contenteditable div for input
  function findChatInput() {
    // Try multiple selectors that Claude.ai might use
    const selectors = [
      'div.tiptap.ProseMirror[role="textbox"]',
      'div.ProseMirror.tiptap[role="textbox"]',
      'div.ProseMirror[role="textbox"]',
      'div.tiptap[role="textbox"]',
      'div[contenteditable="true"][role="textbox"]',
      'div.ProseMirror[contenteditable="true"]',
      '[data-testid="chat-input"] div[contenteditable="true"]',
      'div[data-message-author-role="user"] div[contenteditable="true"]',
      // More specific Claude selectors
      '.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"].Public-DraftEditor-content'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && isChatInput(element)) {
        console.log('PII Sanitizer: Found input with selector:', selector);
        return element;
      }
    }
    return null;
  }

  // Check if element is likely the chat input
  function isChatInput(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    // Should be visible and reasonably sized
    return rect.width > 100 && rect.height > 20 && rect.width < 1000 && rect.height < 500;
  }

  // Find send button
  function findSendButton() {
    const selectors = [
      'button[aria-label*="Send"]',
      'button[aria-label*="send"]',
      'button[type="submit"]',
      'button[data-testid="send-button"]',
      'button:has(svg[data-icon="arrow-up"])',
      'button:has(svg[data-icon="send"])',
      'button:has(svg):not([aria-label*="Stop"])'
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button && !button.disabled && !button.getAttribute('disabled')) {
        return button;
      }
    }
    return null;
  }

  // Intercept Enter key press
  function handleKeyDown(event) {
    // Only intercept Enter (not Shift+Enter which typically creates new line)
    if (event.key === 'Enter' && !event.shiftKey) {
      const input = event.target;
      const text = input.innerText || input.textContent || '';

      if (text.trim()) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        // Clear the input immediately so user doesn't see it change
        updateInputText(input, '');

        sanitizeText(text).then(sanitized => {
          // Send the sanitized message programmatically without showing it
          // We'll set it briefly, send, then clear
          setTimeout(() => {
            updateInputText(input, sanitized);
            // Trigger Enter to send
            input.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Enter',
              shiftKey: false,
              bubbles: true,
              cancelable: true
            }));

            // Clear input after sending
            setTimeout(() => {
              updateInputText(input, '');
            }, 50);
          }, 50);
        });
      }
    }
  }

  // Update text in contenteditable div
  function updateInputText(element, text) {
    element.innerText = text;
    // Trigger input event to let the app know content changed
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Intercept click on send button
  function handleSendClick(event) {
    const input = findChatInput();
    if (!input) return;

    const text = input.innerText || input.textContent || '';

    if (text.trim() && isEnabled && sanitizeServerHealthy) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      // Clear input immediately
      updateInputText(input, '');

      sanitizeText(text).then(sanitized => {
        // Set sanitized text and click send
        setTimeout(() => {
          updateInputText(input, sanitized);
          event.target.click();

          // Clear input after sending
          setTimeout(() => {
            updateInputText(input, '');
          }, 50);
        }, 50);
      });
    }
  }

  // Set up interception
  function setupInterception() {
    const input = findChatInput();
    if (!input) {
      // Try again after a delay
      setTimeout(setupInterception, 1000);
      return;
    }

    // Add keydown listener for Enter key
    input.addEventListener('keydown', handleKeyDown, true);

    // Monitor for send button clicks using event delegation
    document.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (button && isSendButton(button)) {
        handleSendClick(event);
      }
    }, true);

    // Re-setup periodically to catch DOM changes
    setInterval(() => {
      const currentInput = findChatInput();
      if (currentInput && currentInput !== input) {
        input.removeEventListener('keydown', handleKeyDown);
        currentInput.addEventListener('keydown', handleKeyDown, true);
      }
    }, 5000);
  }

  function isSendButton(button) {
    const ariaLabel = button.getAttribute('aria-label') || '';
    return ariaLabel.toLowerCase().includes('send');
  }

  // Listen for storage changes (toggle state)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.piiSanitizerEnabled) {
      isEnabled = changes.piiSanitizerEnabled.newValue !== false;
    }
  });

  // Listen for server health updates
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'serverHealth') {
      sanitizeServerHealthy = request.isHealthy;
    }
  });

  // Initialize
  loadEnabledState();
  setupInterception();

  console.log('PII Sanitizer: Claude.ai content script loaded');
})();