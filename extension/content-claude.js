// PII Sanitizer for Claude.ai - Simple working version
(function() {
  'use strict';

  console.log('PII Sanitizer: Claude.ai simple version loaded');

  let isEnabled = true;
  let inputElement = null;
  let sendButton = null;
  let observer = null;
  let isProcessing = false;

  function loadEnabledState() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get(['piiSanitizerEnabled'], (result) => {
          isEnabled = result.piiSanitizerEnabled !== false;
          console.log('Extension enabled:', isEnabled);
        });
      }
    } catch (e) {
      console.log('Extension not checking state');
    }
  }

  async function sanitizeText(text) {
    if (!isEnabled) {
      return text;
    }

    try {
      console.log('Sanitizing:', text.substring(0, 30));

      const response = await fetch('http://localhost:8787/sanitize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text }),
        signal: AbortSignal.timeout(3000)
      });

      if (!response.ok) {
        console.error('Server error:', response.status);
        return text;
      }

      const data = await response.json();
      console.log('Sanitized:', data.sanitized);
      return data.sanitized || text;

    } catch (error) {
      console.error('Sanitization failed:', error.message);
      console.log('Returning original text due to error');
      return text;
    }
  }

  function findChatInput() {
    console.log('Looking for chat input...');

    const selectors = [
      '[contenteditable="true"][role="textbox"]',
      '.ProseMirror[contenteditable="true"]',
      '.tiptap.ProseMirror[role="textbox"]',
      '.tiptap[contenteditable="true"]',
      '[role="textbox"]',
      'div[contenteditable="true"]',
      '[contenteditable="true"]'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        const rect = element.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0;
        const reasonableSize = rect.width < 2000 && rect.height < 1000;

        if (isVisible && reasonableSize) {
          console.log('Found chat input via:', selector);
          console.log('Element:', element.tagName, element.className);
          return element;
        }
      }
    }

    console.error('No chat input found');
    return null;
  }

  function findSendButton() {
    const selectors = [
      'button[aria-label="Send message"]',
      'button[aria-label*="Send" i]',
      '[data-testid="send-button"]'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return element;
        }
      }
    }

    return null;
  }

  function getTextFromInput(input) {
    return input.innerText || input.textContent || '';
  }

  function setTextInInput(input, text) {
    input.innerText = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function reportTranscript(originalText, textToSend) {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({
        action: 'saveTranscriptEntry',
        site: 'claude.ai',
        original: originalText,
        sanitized: textToSend
      });
    }
  }

  // Sanitizes the input's current text, then calls submit() to actually
  // send it. Guarded by isProcessing so the synthetic Enter/click submit()
  // triggers below don't re-enter this function recursively.
  async function sanitizeAndSubmit(input, submit) {
    if (isProcessing) return;

    const originalText = getTextFromInput(input);
    if (!originalText.trim()) return;

    isProcessing = true;
    try {
      let textToSend = originalText;

      if (isEnabled) {
        console.log('Attempting sanitization...');
        textToSend = await sanitizeText(originalText);
        console.log(textToSend !== originalText ? 'Sanitized successfully!' : 'Text unchanged, sending as-is');
      } else {
        console.log('Extension disabled, sending original');
      }

      reportTranscript(originalText, textToSend);
      setTextInInput(input, textToSend);

      await new Promise(resolve => setTimeout(resolve, 100));
      submit(input);
    } catch (error) {
      console.error('Error:', error);
      console.log('Fallback: sending original');
      setTextInInput(input, originalText);
      await new Promise(resolve => setTimeout(resolve, 50));
      submit(input);
    } finally {
      isProcessing = false;
    }
  }

  function submitViaEnter(input) {
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: false,
      bubbles: true,
      cancelable: true
    }));
  }

  function submitViaButtonClick() {
    const button = findSendButton();
    if (button) {
      button.click();
    } else {
      console.error('Send button not found for programmatic submit, falling back to Enter');
      submitViaEnter(inputElement);
    }
  }

  function handleKeyDown(event) {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    if (isProcessing) {
      // Our own synthetic redispatch to actually submit - let it through.
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    sanitizeAndSubmit(event.target, submitViaEnter);
  }

  function handleSendClick(event) {
    if (isProcessing) {
      // Our own programmatic re-click to actually submit - let it through.
      return;
    }
    if (!inputElement) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    sanitizeAndSubmit(inputElement, submitViaButtonClick);
  }

  function setupInterception() {
    console.log('Setting up interception...');

    inputElement = findChatInput();

    if (!inputElement) {
      console.log('Input not found, waiting with observer...');

      observer = new MutationObserver(() => {
        inputElement = findChatInput();
        if (inputElement && !inputElement._hasListener) {
          console.log('Input found via observer, attaching listener');
          attachListener();
        }
        attachSendButtonListener();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['contenteditable', 'role', 'data-id', 'placeholder', 'aria-label']
      });

      return;
    }

    attachListener();
    attachSendButtonListener();
  }

  function attachListener() {
    if (!inputElement || inputElement._hasListener) return;

    console.log('Attaching listener to input');
    inputElement.addEventListener('keydown', handleKeyDown, true);
    inputElement._hasListener = true;

    console.log('Input element:', inputElement.tagName, inputElement.className);
  }

  function attachSendButtonListener() {
    const button = findSendButton();
    if (!button || button === sendButton) return;

    if (sendButton) {
      sendButton.removeEventListener('click', handleSendClick, true);
    }

    console.log('Attaching listener to send button');
    button.addEventListener('click', handleSendClick, true);
    sendButton = button;
  }

  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.piiSanitizerEnabled) {
        isEnabled = changes.piiSanitizerEnabled.newValue !== false;
        console.log('Extension state changed:', isEnabled);
      }
    });
  }

  // Initialize
  loadEnabledState();
  setupInterception();

  setTimeout(setupInterception, 1000);
  setTimeout(setupInterception, 3000);
  setTimeout(setupInterception, 5000);
  setInterval(() => {
    const currentInput = findChatInput();
    if (currentInput && currentInput !== inputElement) {
      console.log('Input changed, re-attaching');
      inputElement = currentInput;
      attachListener();
    }
    attachSendButtonListener();
  }, 10000);

  console.log('PII Sanitizer initialized');
})();
