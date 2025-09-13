import os
import random
from pathlib import Path
from openai import OpenAI

# -------------------------
# Set your API key here
# -------------------------
os.environ["OPENAI_API_KEY"] = "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"

# Initialize OpenAI client
client = OpenAI()

# -------------------------
# Voice options (random selection)
# -------------------------
voices = ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"]
selected_voice = random.choice(voices)
print(f"Using voice: {selected_voice}")

# -------------------------
# Path to save generated audio
# -------------------------
speech_file_path = Path("story.mp3")

# -------------------------
# Your long text prompt (Reddit story example)
# -------------------------
story_prompt = """
AITA for refusing to attend my cousin's wedding after he asked me to be in the wedding party?
So, my cousin recently got engaged, and he asked me to be one of his groomsmen. 
At first, I was excited, but then I found out that he expected me to pay for the suit, the bachelor party, and a significant portion of the wedding gift. 
I simply can't afford it right now. When I explained this, he got upset and implied that if I didn't participate financially, I shouldn't come at all. 
Am I the asshole for saying I won't attend the wedding under these circumstances?
"""

# -------------------------
# Generate audio using TTS
# -------------------------
with client.audio.speech.with_streaming_response.create(
    model="gpt-4o-mini-tts",
    voice=selected_voice,
    input=story_prompt,
    instructions="Read this story clearly and with a natural, engaging tone."
) as response:
    response.stream_to_file(speech_file_path)

print(f"Audio saved to: {speech_file_path}")
