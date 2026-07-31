from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from presidio_analyzer import AnalyzerEngine
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

analyzer = AnalyzerEngine()
anonymizer = AnonymizerEngine()

@app.post("/sanitize")
def sanitize(payload: dict):
    text = payload["text"]
    results = analyzer.analyze(text=text, language="en")
    return {"sanitized": anonymizer.anonymize(text=text, analyzer_results=results).text}
