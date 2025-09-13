from flask import Flask, render_template
import os, re

app = Flask(__name__, static_folder="static", template_folder="templates")

def list_videos():
    """Return browser paths for all .mp4 files in static/video/, sorted numerically when possible."""
    videos_dir = os.path.join(app.static_folder, "video")
    names = []
    try:
        for n in os.listdir(videos_dir):
            if n.lower().endswith(".mp4"):
                names.append(n)
    except FileNotFoundError:
        pass

    def sort_key(name):
        m = re.search(r'(\d+)', name)
        return (int(m.group(1)) if m else 10**9, name.lower())

    names.sort(key=sort_key)
    return [f"/static/video/{n}" for n in names]

@app.route("/")
def index():
    video_srcs = list_videos()
    return render_template("index.html", video_srcs=video_srcs)

if __name__ == "__main__":
    app.run(debug=False, use_reloader=False)
