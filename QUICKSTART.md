# Quick Start Guide

## 5-Minute Setup

### 1. Install dependencies
```bash
git clone https://github.com/harleenkaurbhatia/pii-sanitizer.git
cd pii-sanitizer
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Start the server
```bash
python3 -m uvicorn server.server:app --reload --port 8787
```

*Note: First run downloads a 400MB language model (2-3 minutes)*

### 3. Load Chrome extension
- Open `chrome://extensions/`
- Enable "Developer mode"
- Click "Load unpacked" → select `extension/` folder

### 4. Test it
- Visit claude.ai or chatgpt.com
- Type: "My email is test@example.com"
- Press Enter → should appear as: "My email is <EMAIL_ADDRESS>"

## Common Commands

**Start server:**
```bash
source venv/bin/activate
python3 -m uvicorn server.server:app --reload --port 8787
```

**Stop server:**
```bash
Ctrl+C
```

**Kill port if stuck:**
```bash
lsof -ti:8787 | xargs kill -9  # macOS/Linux
```

**Test server manually:**
```bash
curl http://localhost:8787/sanitize -X POST \
  -H "Content-Type: application/json" \
  -d '{"text":"My email is test@example.com"}'
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Extension shows red "!" | Start the server first |
| Nothing gets redacted | Toggle extension ON, reload page |
| Port already in use | `lsof -ti:8787 | xargs kill -9` |
| Server won't start | Check Python 3.8+ installed |

## What gets redacted

✅ Emails: `user@example.com` → `<EMAIL_ADDRESS>`  
✅ Phones: `555-123-4567` → `<PHONE_NUMBER>`  
✅ Credit cards: `4111-1111-1111-1111` → `<CREDIT_CARD>`  
✅ Names: `John Smith` → `<PERSON>`  
✅ Addresses: `123 Main St` → `<LOCATION>`  
✅ URLs: `https://example.com` → `<URL>`  
✅ Dates: `2024-01-01` → `<DATE>`  
✅ Social Security: `123-45-6789` → `<US_SSN>`  
✅ IP addresses: `192.168.1.1` → `<IP_ADDRESS>`

## Support

- GitHub: https://github.com/harleenkaurbhatia/pii-sanitizer
- Issues: Check console (F12) for debug messages