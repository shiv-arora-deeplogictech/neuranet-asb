import sys, json, zlib, whisper, base64, os, tempfile

# Try to load the Whisper model safely
try:
    model = whisper.load_model("medium")
except Exception as e:
    print(json.dumps({"result": False, "reason": f"Failed to load Whisper model: {str(e)}"}))
    sys.exit(1)

def transcribe_audio(data):
    try:
        audio_b64 = data.get("audiofile")
        if not audio_b64:
            return {"result": False, "reason": "Missing audiofile"}

        # Decode Base64 audio
        try:
            audio_bytes = base64.b64decode(audio_b64)
        except Exception as e:
            return {"result": False, "reason": f"Base64 decode error: {str(e)}"}

        # Save to a temporary file
        temp_path = os.path.join(tempfile.gettempdir(), "upload.webm")
        with open(temp_path, "wb") as f:
            f.write(audio_bytes)

        # Transcribe with Whisper
        result = model.transcribe(temp_path, task="transcribe")
        os.remove(temp_path)

        return {
            "result": True,
            "language": result.get("language", "unknown"),
            "text": result.get("text", "")
        }
    except Exception as e:
        return {"result": False, "reason": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"result": False, "reason": "Missing input JSON file"}))
        sys.exit(1)

    input_file = sys.argv[1]

    # Read JSON from the provided file
    try:
        with open(input_file, "rb") as f:
            raw_body = f.read()

        try:
            data = json.loads(raw_body.decode("utf-8"))
        except UnicodeDecodeError:
            decompressed = zlib.decompress(raw_body, 16 + zlib.MAX_WBITS)
            data = json.loads(decompressed.decode("utf-8"))
    except Exception as e:
        print(json.dumps({"result": False, "reason": f"Invalid request format: {str(e)}"}))
        sys.exit(1)

    result = transcribe_audio(data)
    print(json.dumps(result))