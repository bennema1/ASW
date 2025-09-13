from flask import Flask, render_template
import os

app = Flask(__name__, static_folder="static", template_folder="templates")

@app.route("/")
def index():
    """Render one card per .mp4 found in webapp/static/video/ (singular)."""
    print("RUNNING FROM:", __file__)  # sanity: which copy is running?

    videos_dir = os.path.join(app.static_folder, "video")  # << singular
    filenames = []
    try:
        for name in sorted(os.listdir(videos_dir)):
            if name.lower().endswith(".mp4"):
                filenames.append(name)
    except FileNotFoundError:
        pass

    # Build browser paths: /static/video/<file>
    video_srcs = [f"/static/video/{name}" for name in filenames]
    print("Serving videos:", video_srcs)

    return render_template("index.html", video_srcs=video_srcs)

if __name__ == "__main__":
    app.run(debug=False, use_reloader=False)
