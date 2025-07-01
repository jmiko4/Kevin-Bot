from flask import Flask, request, send_file
from TTS.api import TTS
import tempfile
import os

app = Flask(__name__)

# Load the VCTK VITS model with multi-speaker support
tts = TTS(model_name="tts_models/en/vctk/vits")

@app.route("/speak", methods=["POST"])
def speak():
    text = request.json.get("text")
    if not text:
        return {"error": "No text provided"}, 400

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tts.tts_to_file(text=text, speaker="p232", file_path=tmp.name)
        return send_file(tmp.name, mimetype="audio/wav", as_attachment=True, download_name="speech.wav")

if __name__ == "__main__":
    app.run(port=5002)
