import os
import random
from pathlib import Path
from openai import OpenAI

#OpenAI API Key
os.environ["OPENAI_API_KEY"] = "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"

client = OpenAI()

#randomize voices
voices = ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"]
selected_voice = random.choice(voices)
print(f"Using voice: {selected_voice}")


speech_file_path = Path("story.mp3")

def get_story():
    return "At midnight, Emma heard her phone ring. It was a call from her own number. Trembling, she answered. A whisper hissed, “I’m inside your house.” She froze—she lived alone."

story_text = get_story()

with client.audio.speech.with_streaming_response.create(
    model="gpt-4o-mini-tts",
    voice=selected_voice,
    input=story_text,
    instructions="Depending on the theme of the story, narrate in a way that engages and interests readers"
) as response:
    response.stream_to_file(speech_file_path)

print(f"Audio saved to: {speech_file_path}")
