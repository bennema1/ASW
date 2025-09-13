# webapp/app.py
#
# PURPOSE:
# Minimal Flask server that will serve:
#   - one route ("/") to render our HTML page
#   - static files from /static (video + CSS)
#
# We keep this super small so it’s easy to reason about.

from flask import Flask, render_template

# Create the Flask app.
# - static_folder tells Flask where to find files you serve “as-is” (CSS, videos).
# - template_folder is where our HTML templates live.

app = Flask(
    __name__,
    static_folder="static",
    template_folder="templates"
)

@app.route("/")
def index():
    """
    Render the feed with multiple videos.
    We list files in webapp/static/videos and build full URLs for the template.
    """
    videos_dir = os.path.join(app.static_folder, "videos")
    # Collect .mp4 files that actually exist (sorted by name for now)
    filenames = []
    try:
        for name in sorted(os.listdir(videos_dir)):
            if name.lower().endswith(".mp4"):
                filenames.append(name)
    except FileNotFoundError:
        pass

    # Fallback: if nothing is found, default to bg1.mp4 (your first file)
    if not filenames:
        filenames = ["bg1.mp4"]

    # Turn filenames into browser paths like /static/videos/xxx.mp4
    video_srcs = [f"/static/videos/{name}" for name in filenames]

    return render_template("index.html", video_srcs=video_srcs)
    # ^ index.html will loop over video_srcs to render one card per file

# When you run `python app.py` locally, this starts a dev server on http://127.0.0.1:5000
if __name__ == "__main__":
    app.run(debug=True)
