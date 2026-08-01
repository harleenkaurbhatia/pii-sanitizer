import io
import time
import uuid

import fitz  # PyMuPDF
import pytesseract
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image, ImageDraw
from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer
from presidio_anonymizer import AnonymizerEngine

app = FastAPI()

# Add CORS middleware to allow chrome extension requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _build_analyzer():
    engine = AnalyzerEngine()

    # Presidio's built-in recognizers cover general PII (email, phone, name,
    # credit card, SSN, ...) but have no concept of API keys/secrets - add
    # pattern recognizers for the common key formats people paste into chats.
    api_key_patterns = [
        Pattern(name="openai_api_key", regex=r"\bsk-(proj-|ant-)?[A-Za-z0-9_-]{20,}\b", score=0.9),
        Pattern(name="aws_access_key", regex=r"\bAKIA[0-9A-Z]{16}\b", score=0.9),
        Pattern(name="github_token", regex=r"\bgh[pousr]_[A-Za-z0-9]{36,}\b", score=0.9),
        Pattern(name="slack_token", regex=r"\bxox[baprs]-[0-9A-Za-z-]{10,}\b", score=0.85),
        Pattern(name="google_api_key", regex=r"\bAIza[0-9A-Za-z_-]{35}\b", score=0.9),
        Pattern(name="stripe_key", regex=r"\b(sk|pk)_live_[0-9a-zA-Z]{20,}\b", score=0.9),
        Pattern(name="jwt", regex=r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b", score=0.7),
        Pattern(name="generic_bearer_token", regex=r"\bBearer\s+[A-Za-z0-9._-]{20,}\b", score=0.6),
    ]
    engine.registry.add_recognizer(
        PatternRecognizer(supported_entity="API_KEY", patterns=api_key_patterns)
    )
    return engine


analyzer = _build_analyzer()
anonymizer = AnonymizerEngine()

MAX_FILE_BYTES = 20 * 1024 * 1024  # 20MB
SCAN_TTL_SECONDS = 10 * 60

# In-memory store for scanned files awaiting a redaction request.
# Local single-user tool, so a plain dict with a TTL sweep is enough.
_scans = {}


@app.post("/sanitize")
def sanitize(payload: dict):
    text = payload["text"]
    results = analyzer.analyze(text=text, language="en")
    return {"sanitized": anonymizer.anonymize(text=text, analyzer_results=results).text}


def _sweep_expired_scans():
    now = time.time()
    for scan_id in [k for k, v in _scans.items() if now - v["created"] > SCAN_TTL_SECONDS]:
        del _scans[scan_id]


def _detect_kind(filename: str, content_type: str) -> str:
    name = (filename or "").lower()
    if content_type == "application/pdf" or name.endswith(".pdf"):
        return "pdf"
    if (content_type or "").startswith("image/") or name.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp")):
        return "image"
    return "unsupported"


def _words_and_text(word_tuples):
    """word_tuples: list of (page_index, x0, y0, x1, y1, word_text) in reading order.
    Returns a single text blob (words joined by a space) plus a matching list of
    (start, end) character offsets, so entity spans found in the text can be
    mapped back to the word (and its bounding box) that produced them."""
    parts = []
    spans = []
    offset = 0
    for wt in word_tuples:
        word_text = wt[-1]
        start = offset
        end = start + len(word_text)
        spans.append((start, end))
        parts.append(word_text)
        offset = end + 1  # +1 for the joining space
    return " ".join(parts), spans


OCR_MIN_CHARS_PER_PAGE = 20  # below this, treat the page as scanned (image-only) and OCR it
OCR_RENDER_ZOOM = 200 / 72  # render at ~200 DPI for OCR


def _ocr_page(page):
    pix = page.get_pixmap(matrix=fitz.Matrix(OCR_RENDER_ZOOM, OCR_RENDER_ZOOM))
    image = Image.open(io.BytesIO(pix.tobytes("png")))
    ocr = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)

    words = []
    for i, text in enumerate(ocr["text"]):
        if not text.strip():
            continue
        # OCR coordinates are in rendered-image pixels; scale back to PDF point space.
        left = ocr["left"][i] / OCR_RENDER_ZOOM
        top = ocr["top"][i] / OCR_RENDER_ZOOM
        width = ocr["width"][i] / OCR_RENDER_ZOOM
        height = ocr["height"][i] / OCR_RENDER_ZOOM
        words.append((left, top, left + width, top + height, text))
    return words


def _extract_pdf_words(data: bytes):
    doc = fitz.open(stream=data, filetype="pdf")
    words = []
    for page_index in range(len(doc)):
        page = doc[page_index]
        page_words = [
            (x0, y0, x1, y1, word_text)
            for x0, y0, x1, y1, word_text, *_ in page.get_text("words")
            if word_text.strip()
        ]

        text_chars = sum(len(w[-1]) for w in page_words)
        if text_chars < OCR_MIN_CHARS_PER_PAGE:
            # Little to no real text layer on this page - likely a scanned
            # image. Fall back to OCR so we don't silently report "no PII".
            page_words = _ocr_page(page)

        words.extend((page_index, x0, y0, x1, y1, word_text) for x0, y0, x1, y1, word_text in page_words)

    doc.close()
    return words


def _extract_image_words(data: bytes):
    image = Image.open(io.BytesIO(data))
    ocr = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
    words = []
    for i, text in enumerate(ocr["text"]):
        if not text.strip():
            continue
        left, top = ocr["left"][i], ocr["top"][i]
        width, height = ocr["width"][i], ocr["height"][i]
        words.append((0, left, top, left + width, top + height, text))
    return words


def _flagged_word_indices(words, spans, analyzer_results):
    flagged = set()
    for i, (start, end) in enumerate(spans):
        for r in analyzer_results:
            if r.start < end and r.end > start:
                flagged.add(i)
                break

    # OCR often splits an email into disjoint fragments ("jane." "roe" "@exam"
    # "ple.com"), so the email pattern never matches as a whole and only part
    # of it gets flagged above. "@" is a near-certain signal an email is
    # nearby, so also redact its immediate neighbors on the same page/line.
    at_sign_indices = [i for i, w in enumerate(words) if "@" in w[-1]]
    for i in at_sign_indices:
        flagged.add(i)
        for neighbor in range(i - 2, i + 3):
            if 0 <= neighbor < len(words) and words[neighbor][0] == words[i][0]:
                flagged.add(neighbor)

    return flagged


@app.post("/scan-file")
async def scan_file(file: UploadFile = File(...)):
    _sweep_expired_scans()

    data = await file.read()
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(413, "File too large")

    kind = _detect_kind(file.filename, file.content_type)
    if kind == "unsupported":
        return {"supported": False}

    try:
        words = _extract_pdf_words(data) if kind == "pdf" else _extract_image_words(data)
    except Exception as e:
        raise HTTPException(422, f"Could not read file: {e}")

    full_text, spans = _words_and_text(words)
    results = analyzer.analyze(text=full_text, language="en") if full_text.strip() else []

    if not results:
        return {"supported": True, "has_pii": False, "entities": []}

    entities = sorted({r.entity_type for r in results})
    scan_id = uuid.uuid4().hex
    _scans[scan_id] = {
        "raw_bytes": data,
        "kind": kind,
        "filename": file.filename,
        "content_type": file.content_type,
        "words": words,
        "spans": spans,
        "results": results,
        "created": time.time(),
    }

    return {"supported": True, "has_pii": True, "entities": entities, "scan_id": scan_id}


@app.get("/scan-file/{scan_id}/redacted")
def get_redacted_file(scan_id: str):
    scan = _scans.get(scan_id)
    if not scan:
        raise HTTPException(404, "Scan not found or expired")

    flagged = _flagged_word_indices(scan["words"], scan["spans"], scan["results"])
    flagged_words = [scan["words"][i] for i in flagged]

    if scan["kind"] == "pdf":
        doc = fitz.open(stream=scan["raw_bytes"], filetype="pdf")
        by_page = {}
        for page_index, x0, y0, x1, y1, _ in flagged_words:
            by_page.setdefault(page_index, []).append(fitz.Rect(x0, y0, x1, y1))

        for page_index, rects in by_page.items():
            page = doc[page_index]
            for rect in rects:
                page.add_redact_annot(rect, fill=(0, 0, 0))
            page.apply_redactions()

        redacted_bytes = doc.tobytes()
        doc.close()
        media_type = "application/pdf"
    else:
        image = Image.open(io.BytesIO(scan["raw_bytes"])).convert("RGB")
        drawer = ImageDraw.Draw(image)
        for _, x0, y0, x1, y1, _ in flagged_words:
            drawer.rectangle([x0, y0, x1, y1], fill=(0, 0, 0))

        buf = io.BytesIO()
        image_format = (scan["content_type"] or "image/png").split("/")[-1].upper()
        image_format = "JPEG" if image_format in ("JPG", "JPEG") else "PNG"
        image.save(buf, format=image_format)
        redacted_bytes = buf.getvalue()
        media_type = scan["content_type"] or "image/png"

    filename = scan["filename"] or "redacted"
    return Response(
        content=redacted_bytes,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="redacted-{filename}"'},
    )
