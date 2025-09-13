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
    This function handles requests to "/".
    It renders templates/index.html and passes it a variable called video_src.
    For now we point at /static/videos/bg1.mp4 (you’ll upload that later).
    """
    video_src = "/static/videos/bg1.mp4"
    return render_template("index.html", video_src=video_src)

# When you run `python app.py` locally, this starts a dev server on http://127.0.0.1:5000
if __name__ == "__main__":
    app.run(debug=True)
