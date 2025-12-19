# Database Setup Guide

## Prerequisites

Before running the agent, you need to have:
1. **Qdrant** running (local or cloud)
2. **Neo4j** running (local or cloud)
3. **Python 3.12** with virtual environment

---

## Step 1: Install Dependencies

```bash
cd agent
.venv\Scripts\activate  # Windows
# or
source .venv/bin/activate  # Mac/Linux

pip install -r requirements.txt
```

This will install:
- `qdrant-client` - Qdrant vector database client
- `neo4j` - Neo4j graph database driver
- `sentence-transformers` - For embedding queries
- `llama-index-embeddings-huggingface` - Compatibility with your existing setup
- All existing dependencies (LangGraph, CopilotKit, etc.)

---

## Step 2: Set Up Environment Variables

Copy the example file:
```bash
cp .env.example .env
```

Edit `.env` and fill in your credentials:

```bash
# OpenAI (required)
OPENAI_API_KEY=sk-your-actual-key-here

# Qdrant
QDRANT_URL=http://localhost:6333  # or your Qdrant Cloud URL
QDRANT_API_KEY=  # Leave empty if using local Qdrant

# Neo4j
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-password-here

# NVIDIA (optional - only if you use it for other models)
NVIDIA_API_KEY=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
```

---

## Step 3: Verify Database Connections

### Option A: Local Qdrant

**Install Qdrant locally:**
```bash
docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant
```

**Verify it's running:**
```bash
curl http://localhost:6333
```

### Option B: Qdrant Cloud

If you're using Qdrant Cloud:
1. Get your cluster URL from the Qdrant Cloud dashboard
2. Get your API key
3. Update `QDRANT_URL` and `QDRANT_API_KEY` in `.env`

---

### Option A: Local Neo4j

**Install Neo4j locally:**

**Using Docker:**
```bash
docker run -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=neo4j/your-password neo4j:latest
```

**Or download**: https://neo4j.com/download/

**Verify it's running:**
- Web interface: http://localhost:7474
- Or use `cypher-shell` CLI

### Option B: Neo4j AuraDB (Cloud)

If using Neo4j Aura:
1. Get your connection URI (starts with `neo4j+s://`)
2. Get your username and password
3. Update `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` in `.env`

---

## Step 4: Test Database Connections

Create a test script `test_connections.py`:

```python
from config import get_qdrant_client, get_neo4j_driver, embed_query

print("Testing Qdrant connection...")
try:
    client = get_qdrant_client()
    collections = client.get_collections()
    print(f"✅ Qdrant connected! Collections: {collections}")
except Exception as e:
    print(f"❌ Qdrant error: {e}")

print("\nTesting Neo4j connection...")
try:
    driver = get_neo4j_driver()
    with driver.session() as session:
        result = session.run("RETURN 'Hello Neo4j!' AS message")
        print(f"✅ Neo4j connected! {result.single()['message']}")
    driver.close()
except Exception as e:
    print(f"❌ Neo4j error: {e}")

print("\nTesting embedding model...")
try:
    vector = embed_query("test query")
    print(f"✅ Embedding model loaded! Vector dimension: {len(vector)}")
except Exception as e:
    print(f"❌ Embedding error: {e}")
```

Run it:
```bash
python test_connections.py
```

Expected output:
```
Testing Qdrant connection...
✅ Qdrant connected! Collections: CollectionsResponse(...)

Testing Neo4j connection...
✅ Neo4j connected! Hello Neo4j!

Testing embedding model...
✅ Embedding model loaded! Vector dimension: 384
```

---

## Step 5: Verify Your Data

### Check Qdrant Collection

```python
from config import get_qdrant_client, QDRANT_COLLECTION_NAME

client = get_qdrant_client()
info = client.get_collection(QDRANT_COLLECTION_NAME)
print(f"Collection: {QDRANT_COLLECTION_NAME}")
print(f"Points count: {info.points_count}")
print(f"Vector size: {info.config.params.vectors.size}")
```

### Check Neo4j Data

```cypher
// In Neo4j Browser (http://localhost:7474)

// Count exams
MATCH (e:Exam) RETURN count(e)

// Count exercises
MATCH (ex:Exercise) RETURN count(ex)

// Sample exam
MATCH (e:Exam)-[:CONTAINS]->(ex:Exercise)-[:COVERS_TOPIC]->(t:Topic)
RETURN e.year, e.session, e.section, ex.id, t.name
LIMIT 5
```

---

## Step 6: Start the Agent

```bash
cd agent
.venv\Scripts\activate
langgraph dev --port 8123
```

You should see:
```
- 🚀 API: http://127.0.0.1:8123
```

---

## Troubleshooting

### "No module named 'qdrant_client'"
```bash
pip install qdrant-client
```

### "Could not connect to Qdrant"
- Check if Qdrant is running: `curl http://localhost:6333`
- Verify `QDRANT_URL` in `.env`

### "Neo4j connection refused"
- Check if Neo4j is running: visit `http://localhost:7474`
- Verify `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` in `.env`

### "Collection not found"
Your Qdrant collection name must match what you used during indexing:
- Check the collection name in `config.py` (`QDRANT_COLLECTION_NAME`)
- Update it if needed to match your actual collection

### "Embedding model download slow"
The first time you run, `sentence-transformers` will download the model (~80MB). This is normal.

---

## What's Next?

Once databases are connected and the agent is running:
1. Test the agent via the frontend (`/c/[id]` pages)
2. Try queries like:
   - "Find me complex numbers problems from 2018"
   - "What exercises are about probability?"
   - "Show me Math exercises from the principale session"

The agent will use the tools to query your databases! 🎉
