// PII Sanitizer for ChatGPT.com - Simple version
(function() {
  'use strict';

  console.log('🧪 PII Sanitizer: ChatGPT simple version loaded');

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
          console.log('🔧 Extension enabled:', isEnabled);
        });
      }
    } catch (e) {
      console.log('⚠️  Extension not checking state');
    }
  }

  async function sanitizeText(text) {
    if (!isEnabled) {
      return text;
    }

    try {
      console.log('📨 Attempting to sanitize:', text.substring(0, 30));

      const response = await fetch('http://localhost:8787/sanitize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text }),
        signal: AbortSignal.timeout(3000)
      });

      if (!response.ok) {
        console.error('❌ Server error:', response.status);
        return text;
      }

      const data = await response.json();
      console.log('✅ Sanitized:', data.sanitized);
      return data.sanitized || text;

    } catch (error) {
      console.error('❌ Sanitization failed:', error.message);
      console.log('⚠️  Using original text');
      return text;
    }
  }

  function findChatInput() {
    console.log('🔍 Finding ChatGPT input...');

    const selectors = [
      'textarea[data-id="prompt-textarea"]',
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="Send"]',
      'textarea[aria-label*="message"]',
      '[contenteditable="true"][role="textbox"]',
      '.ProseMirror[contenteditable="true"]',
      '[role="textbox"]',
      'div[contenteditable="true"]',
      '[contenteditable="true"]',
      'textarea'
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);

      for (let j = 0; j < elements.length; j++) {
        const element = elements[j];
        const rect = element.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0;
        const reasonableSize = rect.width > 20 && rect.height > 10 && rect.width < 2000 && rect.height < 1000;

        if (isVisible && reasonableSize) {
          console.log(`✅ Found ChatGPT input via selector ${selector}, element ${j}`);
          return element;
        }
      }
    }

    console.error('❌ No ChatGPT input found');
    return null;
  }

  function findSendButton() {
    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label*="Send" i]'
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
    if (input.tagName === 'TEXTAREA') {
      return input.value;
    } else {
      return input.innerText || input.textContent || '';
    }
  }

  function setTextInInput(input, text) {
    if (input.tagName === 'TEXTAREA') {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      input.innerText = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Sanitizes the input's current text, then calls submit() to actually
  // send it. Guarded by isProcessing so the synthetic Enter/click submit()
  // triggers below don't re-enter this function recursively.
  async function sanitizeAndSubmit(input, submit) {
    if (isProcessing) return;

    const originalText = getTextFromInput(input);
    if (!originalText.trim()) return;

    console.log('📝 Original text:', originalText);
    isProcessing = true;

    try {
      let textToSend = originalText;

      if (isEnabled) {
        console.log('🔄 Attempting sanitization...');
        textToSend = await sanitizeText(originalText);
        console.log(textToSend !== originalText ? '✅ Sanitized successfully!' : 'ℹ️  Text unchanged');
      } else {
        console.log('⏸️  Extension disabled, using original');
      }

      console.log('🎯 Text to send:', textToSend);
      setTextInInput(input, textToSend);

      await new Promise(resolve => setTimeout(resolve, 100));
      submit(input);
    } catch (error) {
      console.error('❌ ERROR:', error);
      console.log('🔄 Fallback: sending original');
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
      console.error('❌ Send button not found for programmatic submit, falling back to Enter');
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

    console.log('⌨️ Enter pressed!');
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

    console.log('🖱️ Send button clicked!');
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    sanitizeAndSubmit(inputElement, submitViaButtonClick);
  }

  function setupInterception() {
    console.log('🔧 Setting up ChatGPT interception...');

    inputElement = findChatInput();

    if (!inputElement) {
      console.log('⏳ Input not found, waiting with observer...');

      observer = new MutationObserver(() => {
        inputElement = findChatInput();
        if (inputElement && !inputElement._hasListener) {
          console.log('✅ Input found via observer');
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

    console.log('✅ Attaching listener to ChatGPT input');
    inputElement.addEventListener('keydown', handleKeyDown, true);
    inputElement._hasListener = true;
  }

  function attachSendButtonListener() {
    const button = findSendButton();
    if (!button || button === sendButton) return;

    if (sendButton) {
      sendButton.removeEventListener('click', handleSendClick, true);
    }

    console.log('✅ Attaching listener to ChatGPT send button');
    button.addEventListener('click', handleSendClick, true);
    sendButton = button;
  }

  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.piiSanitizerEnabled) {
        isEnabled = changes.piiSanitizerEnabled.newValue !== false;
        console.log('🔄 Extension state changed:', isEnabled);
      }
    });
  }

  // Initialize
  loadEnabledState();
  setupInterception();

  // Retry setup multiple times
  setTimeout(setupInterception, 1000);
  setTimeout(setupInterception, 3000);
  setTimeout(setupInterception, 5000);

  // Periodic check
  setInterval(() => {
    const currentInput = findChatInput();
    if (currentInput && currentInput !== inputElement) {
      console.log('🔄 ChatGPT input changed, re-attaching');
      inputElement = currentInput;
      attachListener();
    }
    attachSendButtonListener();
  }, 10000);

  console.log('✅ ChatGPT PII Sanitizer simple version initialized');
})();
