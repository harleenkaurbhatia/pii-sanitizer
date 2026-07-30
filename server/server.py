from fastapi import FastAPI
from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine

app = FastAPI()
analyzer = AnalyzerEngine()
anonymizer = AnonymizerEngine()

@app.post("/sanitize")
def sanitize(payload: dict):
    text = payload["text"]
    results = analyzer.analyze(text=text, language="en")
    return {"sanitized": anonymizer.anonymize(text=text, analyzer_results=results).text}
