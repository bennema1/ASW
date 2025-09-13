# pdtrain.py
import json
import re
import numpy as np
import pandas as pd
from typing import List, Dict, Any
from sklearn.metrics.pairwise import cosine_similarity
from sentence_transformers import SentenceTransformer
from collections import Counter


# -------------------------
# STEP 1. Keyword Extractor
# -------------------------
def extract_keywords(text: str, top_k=5) -> list:
    """Extract simple keyword tags from text using word frequency."""
    words = re.findall(r"\b[a-zA-Z]{3,}\b", text.lower())
    stopwords = {
        "the", "and", "for", "with", "that", "this", "you", "but",
        "are", "was", "from", "have", "not", "they", "your", "all", "any"
    }
    words = [w for w in words if w not in stopwords]
    most_common = [str(w) for w, _ in Counter(words).most_common(top_k)]
    return most_common


# -------------------------
# STEP 2. Normalize Dataset
# -------------------------
def normalize_dataset(raw_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized = []

    for idx, item in enumerate(raw_data, start=1):
        title_match = re.search(r"title:\s*(.+)", item.get("input", ""), re.IGNORECASE)
        title = title_match.group(1).strip() if title_match else f"Story {idx}"

        output_text = item.get("output", "")

        normalized.append({
            "id": idx,
            "title": title,
            "input": item.get("input", ""),
            "output": output_text,
            "tags": extract_keywords(output_text, top_k=5),
            "embedding": None
        })

    return normalized


# -------------------------
# STEP 3. Build Embeddings
# -------------------------
def build_embeddings(df: pd.DataFrame, model_name="all-MiniLM-L6-v2"):
    """Generate embeddings for story outputs."""
    model = SentenceTransformer(model_name)
    embeddings = model.encode(df["output"].tolist(), show_progress_bar=True)
    return embeddings, model


def build_similarity_matrix(embeddings):
    """Compute cosine similarity matrix between all stories."""
    return cosine_similarity(embeddings)


# -------------------------
# STEP 4. Recommend Stories
# -------------------------
def recommend(df: pd.DataFrame, sim_matrix, story_id, top_k=5):
    """Recommend top_k similar stories given a story_id."""
    idx = df.index[df["id"] == story_id][0]
    sims = sim_matrix[idx]

    # sort by similarity, exclude self
    similar_idx = np.argsort(sims)[::-1]
    similar_idx = [i for i in similar_idx if i != idx][:top_k]

    return df.iloc[similar_idx][["id", "title", "tags", "output"]]


# -------------------------
# STEP 5. Main Script
# -------------------------
def main():
    # 1. Load raw data
    with open("dataset.json", "r", encoding="utf-8") as f:
        raw_data = json.load(f)

    # 2. Normalize
    normalized = normalize_dataset(raw_data)

    # Save normalized for reference
    with open("stories.json", "w", encoding="utf-8") as f:
        json.dump(normalized, f, indent=2)

    # 3. Load into DataFrame
    df = pd.DataFrame(normalized)
    print(f"Loaded {len(df)} stories.")

    # 4. Build embeddings
    embeddings, model = build_embeddings(df)

    # Fill embeddings into DataFrame for export
    df["embedding"] = embeddings.tolist()

    # 5. Build similarity matrix
    sim_matrix = build_similarity_matrix(embeddings)

    # 6. Demo: recommend for the first story
    first_id = df.iloc[0]["id"]
    print("\nQuery story:", df.iloc[0]["title"])
    recs = recommend(df, sim_matrix, first_id, top_k=3)

    print("\nRecommendations:")
    for _, row in recs.iterrows():
        print(f"- {row['title']} (id={row['id']}) | tags={row['tags']}")

    # 7. Save enriched dataset with embeddings
    with open("stories_enriched.json", "w", encoding="utf-8") as f:
        json.dump(df.to_dict(orient="records"), f, indent=2)


if __name__ == "__main__":
    main()

