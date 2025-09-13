# webapp/app.py
from flask import Flask, render_template
import os

app = Flask(__name__, static_folder="static", template_folder="templates")

@app.route("/")
def index():
    """Render one card per .mp4 in webapp/static/videos/."""
    videos_dir = os.path.join(app.static_folder, "videos")
    filenames = []
    try:
        for name in sorted(os.listdir(videos_dir)):
            if name.lower().endswith(".mp4"):
                filenames.append(name)
    except FileNotFoundError:
        pass

    if not filenames:
        filenames = ["bg1.mp4"]  # fallback

    video_srcs = [f"/static/videos/{name}" for name in filenames]
    print("Serving videos:", video_srcs)
    return render_template("index.html", video_srcs=video_srcs)

if __name__ == "__main__":
    app.run(debug=True)
