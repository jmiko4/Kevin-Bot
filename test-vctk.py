import os
import re
from TTS.api import TTS

def safe_filename(name):
    return re.sub(r'[^a-zA-Z0-9_\-]', '_', name)

tts = TTS(model_name="tts_models/en/vctk/vits")
text = "Get off my lawn, punk!"

os.makedirs("samples", exist_ok=True)

for speaker in tts.speakers:
    filename = safe_filename(speaker)
    path = f"samples/{filename}.wav"
    print(f"🔊 Generating for {speaker}")
    tts.tts_to_file(text=text, speaker=speaker, file_path=path)
