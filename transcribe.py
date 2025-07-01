import sys
import whisper

model = whisper.load_model("base")
filename = sys.argv[1]
result = model.transcribe(filename)
print(result["text"])
 