"""
Database and Embeddings Configuration

This file sets up connections to Qdrant and Neo4j, and provides the embedding model.
"""

import os
from qdrant_client import QdrantClient
from llama_index.graph_stores.neo4j import Neo4jPropertyGraphStore
from openai import OpenAI
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# ============================================================================
# Qdrant Configuration
# ============================================================================

def get_qdrant_client():
    """
    Get Qdrant client instance.
    
    Configure QDRANT_URL and QDRANT_API_KEY in .env if using Qdrant Cloud.
    For local Qdrant, use: http://localhost:6333
    """
    qdrant_url = os.getenv("QDRANT_URL", "http://localhost:6333")
    qdrant_api_key = os.getenv("QDRANT_API_KEY", None)
    
    if qdrant_api_key:
        client = QdrantClient(url=qdrant_url, api_key=qdrant_api_key)
    else:
        client = QdrantClient(url=qdrant_url)
    
    return client

# Collection name
QDRANT_COLLECTION_NAME = "bac_production_vectors"

# ============================================================================
# Neo4j Configuration (using LlamaIndex for better Aura support)
# ============================================================================

def get_neo4j_graph_store():
    """
    Get Neo4j PropertyGraphStore instance (LlamaIndex wrapper).
    This works better with Neo4j Aura than the raw driver.
    
    Configure NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD in .env
    """
    neo4j_uri = os.getenv("NEO4J_URI", "bolt://localhost:7687")
    neo4j_username = os.getenv("NEO4J_USERNAME", "neo4j")
    neo4j_password = os.getenv("NEO4J_PASSWORD", "password")
    
    graph_store = Neo4jPropertyGraphStore(
        username=neo4j_username,
        password=neo4j_password,
        url=neo4j_uri,
    )
    
    return graph_store

# ============================================================================
# Embedding Model (OpenRouter)
# ============================================================================

# ============================================================================
# Embedding Model (OpenRouter)
# ============================================================================

# Embedding model name
EMBEDDING_MODEL = "sentence-transformers/paraphrase-minilm-l6-v2"

def get_embedding_client():
    """
    Returns the OpenRouter client for embeddings.
    """
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise ValueError("❌ OPENROUTER_API_KEY is missing from .env file!")
        
    return OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=api_key,
    )

def embed_query(query: str) -> list:
    """
    Embed a single query string using OpenRouter.
    Returns a vector (384-dimensional for paraphrase-minilm-l6-v2).
    """
    try:
        client = get_embedding_client()
        response = client.embeddings.create(
            extra_headers={
                "HTTP-Referer": "https://bacprep-ai.com",
                "X-Title": "BacPrep AI",
            },
            model=EMBEDDING_MODEL,
            input=query,
            encoding_format="float"
        )
        return response.data[0].embedding
    except Exception as e:
        raise Exception(f"Failed to embed query: {str(e)}")
