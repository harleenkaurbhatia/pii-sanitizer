# PII Sanitizer

A local-only PII sanitizer for LLM chat tools (Claude, ChatGPT). Detects and redacts sensitive information (emails, phone numbers, addresses, etc.) before it's sent to any external LLM — all processing happens on your own machine.

## Structure
- `server/` — local FastAPI + Presidio server that does the actual detection/redaction
- `extension/` — Chrome extension that intercepts messages on claude.ai and chatgpt.com before they're sent

## Setup

### 1. Clone and install dependencies

```bash
git clone https://github.com/harleenkaurbhatia/pii-sanitizer.git
cd pii-sanitizer

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

File uploads (PDF/image) also need the Tesseract OCR binary installed system-wide (not just a Python package):

```bash
brew install tesseract  # macOS
```

### 2. Start the PII sanitization server

```bash
source venv/bin/activate  # if not already activated
python3 -m uvicorn server.server:app --reload --port 8787
```

The server will start on `http://localhost:8787`. The first time you run it, it will download a ~400MB spaCy language model (this takes 2-3 minutes and is cached for future runs).

### 3. Load the Chrome extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top-right corner
3. Click "Load unpacked" and select the `extension` directory
4. The extension should appear with a green shield icon

### 4. Test it

1. Visit [claude.ai](https://claude.ai) or [chatgpt.com](https://chatgpt.com)
2. Click the extension icon - you should see "✓ Local server connected" in green
3. Type a message with PII: "My email is test@example.com and my phone is 555-123-4567"
4. Press Enter
5. The message will appear in the chat as: "My email is <EMAIL_ADDRESS> and my phone is <PHONE_NUMBER>"

## Usage

- **Toggle sanitization**: Click the extension icon to enable/disable PII sanitization
- **Server status**: The extension shows a red "!" badge if the local server is unreachable
- **Works on both**: Claude.ai and ChatGPT.com
- **File uploads**: Attaching a PDF or image (screenshot, scanned doc) is scanned before it's sent. If it contains sensitive data, you'll see a prompt listing what was found, with the choice to upload a redacted version, upload the original anyway, or cancel the upload.

## What gets redacted

The Presidio library detects and redacts:
- Email addresses
- Phone numbers
- Credit card numbers
- US Social Security Numbers
- IP addresses
- URLs
- Dates
- Names (first and last)
- Addresses
- Locations (cities, states, countries)

Plus custom pattern recognizers for common API keys/secrets:
- OpenAI / Anthropic-style keys (`sk-...`)
- AWS access keys (`AKIA...`)
- GitHub tokens (`ghp_...`, `gho_...`, etc.)
- Slack tokens (`xoxb-...`, etc.)
- Google API keys (`AIza...`)
- Stripe keys (`sk_live_...`, `pk_live_...`)
- JWTs and generic `Bearer <token>` strings

## Known limitations

- **Scanned PDFs**: pages with little to no real text layer are OCR'd automatically (same as images), so a scanned/photographed document still gets checked rather than silently reported as "clean."
- **OCR accuracy**: OCR-based scanning (images and scanned PDF pages) is best-effort. Low-quality scans or unusual fonts can cause the OCR engine to misread or fragment text (e.g. split an email into disconnected pieces), which can leave partial PII visible even after redaction. A heuristic redacts words neighboring any "@" character to catch fragmented emails, which can occasionally over-redact a nearby unrelated word — a deliberate trade-off, since over-redacting a benign word is safer than under-redacting real PII.
- **Fillable PDF forms**: text typed into PDF form fields (not part of the page's regular text) isn't currently extracted or scanned.
- Health-specific entities (diagnoses, medication names, ICD codes) aren't detected — only general PII (email, name, phone, credit card, SSN, etc.) via Presidio.

## Requirements

- Python 3.8+
- Chrome/Chromium browser
- ~500MB disk space (for spaCy language model)
- Tesseract OCR binary (needed for scanning images, and for scanned/image-only PDF pages — regular text-based PDFs work without it)

## Troubleshooting

**Server won't start:**
```bash
# Check if port 8787 is already in use
lsof -ti:8787 | xargs kill -9  # macOS/Linux
# Or use a different port:
python3 -m uvicorn server.server:app --reload --port 8788
```

**Extension shows "Server unreachable":**
- Make sure the server is running
- Check the server logs for errors
- Try accessing `http://localhost:8787` in your browser

**PII isn't being redacted:**
- Check the extension toggle is ON
- Open browser console (F12) for debug messages
- Verify the server is responding: `curl http://localhost:8787/sanitize -X POST -H "Content-Type: application/json" -d '{"text":"test@example.com"}'`

## How it works

1. You type a message in Claude.ai or ChatGPT
2. The Chrome extension intercepts the send action
3. It sends the text to your local FastAPI server at `localhost:8787`
4. Presidio analyzes the text and redacts PII
5. The extension sends the sanitized message to the AI
6. All processing happens locally — your PII never leaves your machine

## Security

- **Local-only processing**: All PII detection happens on your machine
- **No external APIs**: Uses open-source Presidio library
- **No data collection**: The extension doesn't store or send your data anywhere

## License

MIT License
