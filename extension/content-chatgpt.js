// Content script for ChatGPT.com - intercepts messages before they're sent

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

  // Find the chat input element on ChatGPT.com
  // ChatGPT uses a textarea or div with contenteditable
  function findChatInput() {
    const selectors = [
      'textarea[data-id="prompt-textarea"]',
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="Send"]',
      'textarea[aria-label*="Message"]',
      'div[contenteditable="true"][data-placeholder*="Message"]',
      'div[contenteditable="true"][data-id*="prompt"]',
      'div[contenteditable="true"].ProseMirror',
      'div[role="textbox"]',
      '#prompt-textarea',
      'div[contenteditable="true"]'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && isChatInput(element)) {
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
      'button[data-testid="send-button"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="send"]',
      'button[type="submit"]',
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

  // Get text from input (handles both textarea and contenteditable)
  function getInputText(input) {
    if (input.tagName === 'TEXTAREA') {
      return input.value;
    } else if (input.getAttribute('contenteditable') === 'true') {
      return input.innerText || input.textContent || '';
    }
    return '';
  }

  // Set text in input (handles both textarea and contenteditable)
  function setInputText(input, text) {
    if (input.tagName === 'TEXTAREA') {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (input.getAttribute('contenteditable') === 'true') {
      input.innerText = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // Intercept Enter key press
  function handleKeyDown(event) {
    // Only intercept Enter (not Shift+Enter which typically creates new line)
    if (event.key === 'Enter' && !event.shiftKey) {
      const input = event.target;
      const text = getInputText(input);

      if (text.trim()) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        // Clear the input immediately so user doesn't see it change
        setInputText(input, '');

        sanitizeText(text).then(sanitized => {
          // Send the sanitized message without showing it
          setTimeout(() => {
            setInputText(input, sanitized);
            // Trigger Enter to send
            input.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Enter',
              shiftKey: false,
              bubbles: true,
              cancelable: true
            }));

            // Clear input after sending
            setTimeout(() => {
              setInputText(input, '');
            }, 50);
          }, 50);
        });
      }
    }
  }

  // Intercept click on send button
  function handleSendClick(event) {
    const input = findChatInput();
    if (!input) return;

    const text = getInputText(input);

    if (text.trim() && isEnabled && sanitizeServerHealthy) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      // Clear input immediately
      setInputText(input, '');

      sanitizeText(text).then(sanitized => {
        // Set sanitized text and click send
        setTimeout(() => {
          setInputText(input, sanitized);
          event.target.click();

          // Clear input after sending
          setTimeout(() => {
            setInputText(input, '');
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

  console.log('PII Sanitizer: ChatGPT.com content script loaded');
})();