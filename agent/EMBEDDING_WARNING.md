# ⚠️ IMPORTANT: Embedding Model Change

## Issue: Model Mismatch

You originally indexed your Qdrant collection with:
- **Model**: `sentence-transformers/all-MiniLM-L6-v2`
- **Method**: Local HuggingFace embedding

Now you're querying with:
- **Model**: `sentence-transformers/paraphrase-minilm-l6-v2`  
- **Method**: OpenRouter API

## Problem

**These are different models!** Even though both produce 384-dimensional vectors, they use different training and will produce incompatible embeddings. This means:

❌ **Semantic search will NOT work correctly**
- Queries embedded with `paraphrase-minilm-l6-v2` won't match documents indexed with `all-MiniLM-L6-v2`
- Similarity scores will be meaningless
- Search results will be random/poor quality

## Solutions

### Option 1: Re-index with OpenRouter (Recommended)
Re-index your entire Qdrant collection using OpenRouter's embedding API:

**Pros:**
- ✅ Uses API (no local model download)
- ✅ Faster queries (no local inference)
- ✅ Consistent embeddings

**Cons:**
- ❌ Costs API credits for re-indexing
- ❌ Takes time to re-index all documents

### Option 2: Query with Local Model (Matches Indexing)
Switch back to using `all-MiniLM-L6-v2` locally:

**Pros:**
- ✅ Matches your existing index
- ✅ Works immediately
- ✅ No API costs for embeddings

**Cons:**
- ❌ Slower first load (downloads model)
- ❌ Uses local compute

### Option 3: Use OpenRouter with Matching Model
Check if OpenRouter supports `all-MiniLM-L6-v2`:

**Pros:**
- ✅ API-based (no local model)
- ✅ Matches existing index

**Cons:**
- ⚠️  Model may not be available on OpenRouter

## Recommended Action

**For now, to test the system:**
1. Keep the OpenRouter setup (already done)
2. Test that embeddings work (run `python test_connections.py`)
3. **Accept that search results will be suboptimal**

**For production:**
- **Either**: Re-index your entire Qdrant collection with `paraphrase-minilm-l6-v2` via OpenRouter
- **Or**: Switch back to local `all-MiniLM-L6-v2` for querying

## How to Switch Back to Local Model

If you want to match your existing index, edit `config.py`:

```python
# Replace OpenRouter embeddings with local:
from llama_index.embeddings.huggingface import HuggingFaceEmbedding

embed_model = HuggingFaceEmbedding(
    model_name="sentence-transformers/all-MiniLM-L6-v2"
)

def embed_query(query: str):
    return embed_model.get_text_embedding(query)
```

And update `requirements.txt`:
```
sentence-transformers>=2.2.0
llama-index-embeddings-huggingface>=0.1.0
```

---

**Current Status:** ⚠️ System configured with OpenRouter, but embeddings won't match your Qdrant index.
