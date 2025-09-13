# recommend_stories.py
import json
import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
from ollama import Ollama

# -------------------------
# Load stories
# -------------------------
with open("stories_enriched.json", "r", encoding="utf-8") as f:
    stories = json.load(f)

# Convert embeddings back to numpy arrays
for s in stories:
    s["embedding"] = np.array(s["embedding"])

# Load embedding model
embed_model = SentenceTransformer("all-MiniLM-L6-v2")

# Initialize Ollama
ollama = Ollama(model="your-fine-tuned-ollama-model")  # replace with your model name

# -------------------------
# Recommend function
# -------------------------
def recommend(query, top_k=3):
    # 1. Embed the query
    query_vec = embed_model.encode([query])[0]

    # 2. Compute cosine similarities
    sims = [cosine_similarity(query_vec.reshape(1, -1), s["embedding"].reshape(1, -1))[0][0] for s in stories]

    # 3. Get top_k story indices
    top_idx = np.argsort(sims)[::-1][:top_k]

    # 4. Collect keywords from top stories
    keywords = []
    for idx in top_idx:
        keywords.extend(stories[idx]["tags"])
    keywords = list(set(keywords))  # remove duplicates

    # 5. Generate story with Ollama
    prompt = f"Write a story based on these keywords: {', '.join(keywords)}"
    generated_story = ollama.generate(prompt)

    # 6. Return recommended stories + new story
    recommended = [stories[idx] for idx in top_idx]
    return recommended, generated_story

# -------------------------
# Demo
# -------------------------
if __name__ == "__main__":
    user_query = input("Enter a story idea or keywords: ")
    recs, new_story = recommend(user_query)

    print("\nTop recommended stories:")
    for s in recs:
        print(f"- {s['title']} (tags: {', '.join(s['tags'])})")

    print("\nGenerated story from Ollama:")
    print(new_story)
