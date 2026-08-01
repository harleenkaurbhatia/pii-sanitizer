// PII Sanitizer - file upload scanning (PDF / image), shared across sites.
(function() {
  'use strict';

  console.log('PII Sanitizer: file scanner loaded');

  const SERVER_BASE = 'http://localhost:8787';

  let isEnabled = true;
  let isProcessingFiles = false;
  const attachedInputs = new WeakSet();
  let modalStylesInjected = false;

  const ENTITY_LABELS = {
    EMAIL_ADDRESS: 'Email',
    PERSON: 'Name',
    PHONE_NUMBER: 'Phone number',
    CREDIT_CARD: 'Credit card',
    US_SSN: 'SSN',
    US_BANK_NUMBER: 'Bank account',
    IBAN_CODE: 'Bank account (IBAN)',
    LOCATION: 'Location',
    DATE_TIME: 'Date',
    URL: 'URL',
    IP_ADDRESS: 'IP address'
  };

  function formatEntity(type) {
    return ENTITY_LABELS[type] || type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  function loadEnabledState() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get(['piiSanitizerEnabled'], (result) => {
          isEnabled = result.piiSanitizerEnabled !== false;
        });
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && changes.piiSanitizerEnabled) {
            isEnabled = changes.piiSanitizerEnabled.newValue !== false;
          }
        });
      }
    } catch (e) {
      console.log('File scanner: not checking enabled state');
    }
  }

  function isScannableFile(file) {
    const type = file.type || '';
    const name = (file.name || '').toLowerCase();
    if (type === 'application/pdf' || name.endsWith('.pdf')) return true;
    if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/.test(name)) return true;
    return false;
  }

  async function scanFile(file) {
    try {
      const formData = new FormData();
      formData.append('file', file, file.name);
      const response = await fetch(`${SERVER_BASE}/scan-file`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) return { supported: false, error: true };
      return await response.json();
    } catch (error) {
      console.error('File scan failed:', error.message);
      return { supported: false, error: true };
    }
  }

  async function fetchRedactedFile(scanId, originalFile) {
    const response = await fetch(`${SERVER_BASE}/scan-file/${scanId}/redacted`);
    if (!response.ok) throw new Error('Failed to fetch redacted file');
    const blob = await response.blob();
    return new File([blob], `redacted-${originalFile.name}`, { type: originalFile.type });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function injectModalStyles() {
    if (modalStylesInjected) return;
    modalStylesInjected = true;

    const style = document.createElement('style');
    style.textContent = `
      .pii-sanitizer-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 2147483647; display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .pii-sanitizer-modal { background: #fff; color: #1a1a1a; border-radius: 12px; padding: 24px; max-width: 420px; width: 90%; box-shadow: 0 10px 40px rgba(0,0,0,0.3); }
      .pii-sanitizer-modal h3 { margin: 0 0 12px; font-size: 16px; }
      .pii-sanitizer-modal p { margin: 0 0 12px; font-size: 14px; word-break: break-word; }
      .pii-sanitizer-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 20px; }
      .pii-sanitizer-badge { background: #fee2e2; color: #b91c1c; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; }
      .pii-sanitizer-actions { display: flex; flex-direction: column; gap: 8px; }
      .pii-sanitizer-btn { padding: 10px 14px; border-radius: 8px; border: 1px solid #d1d5db; background: #fff; color: #1a1a1a; font-size: 14px; font-weight: 500; cursor: pointer; }
      .pii-sanitizer-btn-primary { background: #2563eb; border-color: #2563eb; color: #fff; }
      .pii-sanitizer-btn-text { border: none; background: none; color: #6b7280; padding: 6px; }
    `;
    document.head.appendChild(style);
  }

  // Resolves to 'redacted' | 'original' | 'cancel'.
  function showFileModal(filename, entities, errorMessage) {
    injectModalStyles();

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'pii-sanitizer-overlay';

      const bodyHtml = errorMessage
        ? `<p>${escapeHtml(errorMessage)}</p>`
        : `<p><strong>${escapeHtml(filename)}</strong> appears to contain:</p>
           <div class="pii-sanitizer-badges">${entities.map(e => `<span class="pii-sanitizer-badge">${escapeHtml(formatEntity(e))}</span>`).join('')}</div>`;

      const redactedButtonHtml = errorMessage
        ? ''
        : `<button data-action="redacted" class="pii-sanitizer-btn pii-sanitizer-btn-primary">Use Redacted Version</button>`;

      overlay.innerHTML = `
        <div class="pii-sanitizer-modal">
          <h3>${errorMessage ? 'Could not scan file' : 'Sensitive data detected'}</h3>
          ${bodyHtml}
          <div class="pii-sanitizer-actions">
            ${redactedButtonHtml}
            <button data-action="original" class="pii-sanitizer-btn">Upload Original</button>
            <button data-action="cancel" class="pii-sanitizer-btn pii-sanitizer-btn-text">Cancel (don't upload this file)</button>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      overlay.addEventListener('click', (event) => {
        const action = event.target.getAttribute('data-action');
        if (!action) return;
        document.body.removeChild(overlay);
        resolve(action);
      });
    });
  }

  async function handleFileInputChange(event) {
    if (isProcessingFiles) {
      // Our own programmatic redispatch to actually submit - let it through.
      return;
    }

    const input = event.target;
    const files = Array.from(input.files || []);
    if (files.length === 0) return;

    if (!isEnabled || !files.some(isScannableFile)) {
      return; // nothing for us to do, let the site handle it normally
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const finalFiles = [];

    for (const file of files) {
      if (!isScannableFile(file)) {
        finalFiles.push(file);
        continue;
      }

      console.log('Scanning file for sensitive data:', file.name);
      const scan = await scanFile(file);

      if (scan.error) {
        const choice = await showFileModal(file.name, [], 'Could not reach the local sanitizer server to scan this file.');
        if (choice !== 'cancel') finalFiles.push(file);
        continue;
      }

      if (!scan.supported || !scan.has_pii) {
        finalFiles.push(file);
        continue;
      }

      const choice = await showFileModal(file.name, scan.entities);
      if (choice === 'cancel') {
        continue;
      } else if (choice === 'redacted') {
        try {
          finalFiles.push(await fetchRedactedFile(scan.scan_id, file));
        } catch (error) {
          console.error('Falling back to original file:', error.message);
          finalFiles.push(file);
        }
      } else {
        finalFiles.push(file);
      }
    }

    isProcessingFiles = true;
    try {
      const dataTransfer = new DataTransfer();
      finalFiles.forEach(f => dataTransfer.items.add(f));
      input.files = dataTransfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } finally {
      isProcessingFiles = false;
    }
  }

  function attachFileInputListeners() {
    document.querySelectorAll('input[type="file"]').forEach((input) => {
      if (attachedInputs.has(input)) return;
      input.addEventListener('change', handleFileInputChange, true);
      attachedInputs.add(input);
      console.log('Attached listener to file input:', input.id || input.className);
    });
  }

  loadEnabledState();
  attachFileInputListeners();

  const observer = new MutationObserver(attachFileInputListeners);
  observer.observe(document.body, { childList: true, subtree: true });

  setInterval(attachFileInputListeners, 10000);
})();
