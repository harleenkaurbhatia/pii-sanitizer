PII Sanitizer Extension
=======================

A Chrome extension that automatically sanitizes PII (Personally Identifiable Information) in chat messages before they're sent to Claude.ai and ChatGPT.

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top-right corner
3. Click "Load unpacked" and select the `extension` directory
4. The extension should now appear in your extensions list

## Usage

1. Make sure your local PII sanitizer server is running on port 8787:
   ```bash
   cd /Users/harleen/pii-sanitizer
   python -m uvicorn main:app --reload
   ```

2. Visit Claude.ai or ChatGPT.com and start typing
3. When you press Enter or click Send, your message will be:
   - Sent to your local server for PII sanitization
   - Replaced with the sanitized version
   - Then submitted to the AI service

4. Click the extension icon to:
   - Toggle sanitization on/off
   - Check server connectivity status

## Features

- **Auto-sanitization**: Messages are sanitized before submission without extra steps
- **Toggle switch**: Enable/disable sanitization via the popup
- **Server health check**: Visual warning when localhost:8787 is unreachable
- **Dual-platform support**: Works on both Claude.ai and ChatGPT.com
- **No build step**: Plain JavaScript, easy to modify

## Troubleshooting

**Server not running**: The extension icon will show a red "!" badge. Start your FastAPI server:
```bash
python -m uvicorn main:app --reload
```

**Messages not being sanitized**: 
- Check that the toggle in the popup is ON
- Verify the server is running and responding at http://localhost:8787
- Check the browser console for errors

**Extension not loading**: 
- Ensure Developer Mode is enabled in chrome://extensions
- Click "Reload" on the extension card
- Check for errors in chrome://extensions page

## Files

- `manifest.json` - Extension configuration
- `background.js` - Service worker for health checks
- `content-claude.js` - Content script for Claude.ai
- `content-chatgpt.js` - Content script for ChatGPT.com
- `popup.html` - Extension popup UI
- `popup.js` - Popup logic
- `icons/` - Extension icons (place your icons here)

## Creating Icons

The extension expects icon files in the `icons/` directory:
- `icon16.png` - 16x16 pixels
- `icon48.png` - 48x48 pixels  
- `icon128.png` - 128x128 pixels

You can use any image editor to create simple icons, or use online tools like:
- https://www.favicon-generator.org/
- https://www.icoconverter.com/