import sys, json, base64, os, tempfile
from gtts import gTTS
from langdetect import detect

def text_to_speech(data):
    try:
        text = data.get("text")
        if not text:
            return {"result": False, "reason": "Missing text"}
        
        try:
            lang = detect(text)
        except:
            lang = "en"

        # Generate speech
        tts = gTTS(text=text, lang=lang)
        output_path = os.path.join(tempfile.gettempdir(), "speech.mp3")
        tts.save(output_path)

        # Encode as Base64
        with open(output_path, "rb") as f:
            audio_base64 = base64.b64encode(f.read()).decode("utf-8")

        return {"result": True, "audiofile": audio_base64}

    except Exception as e:
        return {"result": False, "reason": str(e)}

def get_input_json():
    if len(sys.argv) > 1:
        try:
            return json.loads(sys.argv[1])
        except json.JSONDecodeError:
            pass
    return {}

if __name__ == "__main__":
    data = get_input_json()
    if not data:
        print(json.dumps({"result": False, "reason": "Invalid or missing input"}))
        sys.exit(1)

    result = text_to_speech(data)
    print(json.dumps(result))
