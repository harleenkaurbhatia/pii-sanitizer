// Debug version of Claude.ai content script
(function() {
  'use strict';

  console.log('PII Sanitizer DEBUG: Script loaded');

  // Test finding input elements
  const allContentEditable = document.querySelectorAll('[contenteditable="true"]');
  console.log('PII Sanitizer DEBUG: Found contenteditable elements:', allContentEditable.length);
  allContentEditable.forEach((el, i) => {
    console.log(`PII Sanitizer DEBUG: Element ${i}:`, {
      tag: el.tagName,
      role: el.getAttribute('role'),
      placeholder: el.getAttribute('data-placeholder'),
      className: el.className,
      visible: el.getBoundingClientRect().width > 0
    });
  });

  // Find chat input
  const selectors = [
    'div[contenteditable="true"][role="textbox"]',
    'div.ProseMirror[contenteditable="true"]',
    '[data-testid="chat-input"] div[contenteditable="true"]',
    'div[data-message-author-role="user"] div[contenteditable="true"]',
    '.ql-editor[contenteditable="true"]',
    'div[contenteditable="true"].Public-DraftEditor-content'
  ];

  let foundInput = null;
  selectors.forEach((selector, i) => {
    const element = document.querySelector(selector);
    if (element) {
      console.log(`PII Sanitizer DEBUG: Selector ${i} (${selector}) found element:`, element);
      foundInput = element;
    }
  });

  if (foundInput) {
    console.log('PII Sanitizer DEBUG: Using this input:', foundInput);
    foundInput.addEventListener('keydown', (e) => {
      console.log('PII Sanitizer DEBUG: Keydown event:', e.key, e.shiftKey);
      if (e.key === 'Enter' && !e.shiftKey) {
        console.log('PII Sanitizer DEBUG: Enter pressed, would sanitize');
        const text = foundInput.innerText || foundInput.textContent || '';
        console.log('PII Sanitizer DEBUG: Text to sanitize:', text);
      }
    }, true);
  } else {
    console.error('PII Sanitizer DEBUG: No input element found!');
  }
})();
