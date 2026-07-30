# PII Sanitizer

A local-only PII sanitizer for LLM chat tools (Claude, ChatGPT). Detects and redacts sensitive information (names, emails, card numbers, etc.) before it's sent to any external LLM — all processing happens on your own machine.

## Structure
- `server/` — local FastAPI + Presidio server that does the actual detection/redaction
- `extension/` — Chrome extension that intercepts messages on claude.ai and chatgpt.com before they're sent

## Setup
See `server/requirements.txt` for dependencies.
