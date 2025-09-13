# recommend_stories.py
import json
import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
from ollama import Ollama

with open("stories_enriched.json", "r", encoding="utf-8") as f:
    stories = json.load(f)

for s in stories:
    s["embedding"] = np.array(s["embedding"])

embed_model = SentenceTransformer("all-MiniLM-L6-v2")

ollama = Ollama(model="your-fine-tuned-ollama-model")  # replace with your model name

def recommend(query, top_k=3):
    query_vec = embed_model.encode([query])[0]

    sims = [cosine_similarity(query_vec.reshape(1, -1), s["embedding"].reshape(1, -1))[0][0] for s in stories]

    top_idx = np.argsort(sims)[::-1][:top_k]

    keywords = []
    for idx in top_idx:
        keywords.extend(stories[idx]["tags"])
    keywords = list(set(keywords))  # remove duplicates

    prompt = f"Write a story based on these keywords: {', '.join(keywords)}"
    generated_story = ollama.generate(prompt)

    recommended = [stories[idx] for idx in top_idx]
    return recommended, generated_story


if __name__ == "__main__":
    user_query = input("Enter a story idea or keywords: ")
    recs, new_story = recommend(user_query)

    print("\nTop recommended stories:")
    for s in recs:
        print(f"- {s['title']} (tags: {', '.join(s['tags'])})")

    print("\nGenerated story from Ollama:")
    print(new_story)

