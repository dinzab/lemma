"""
RAG System Testing Script

Tests Qdrant vector search, Neo4j graph queries, and content retrieval.
Run this to verify database connections and query correctness.
"""

import os
import sys
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

print("=" * 80)
print("RAG SYSTEM TESTING")
print("=" * 80)

# ============================================================================
# Test 1: Qdrant Connection & Vector Search
# ============================================================================

print("\n[TEST 1] Testing Qdrant Connection...")
try:
    from config import get_qdrant_client, QDRANT_COLLECTION_NAME, embed_query
    
    client = get_qdrant_client()
    
    # Get collection info
    collection_info = client.get_collection(collection_name=QDRANT_COLLECTION_NAME)
    print(f"✅ Connected to Qdrant!")
    print(f"   Collection: {QDRANT_COLLECTION_NAME}")
    print(f"   Points Count: {collection_info.points_count}")
    print(f"   Vector Size: {collection_info.config.params.vectors.size}")
    
    # Test embedding
    print("\n[TEST 2] Testing Embedding Generation...")
    test_query = "introduction to derivatives for bac students"
    embedding = embed_query(test_query)
    print(f"✅ Embedding generated!")
    print(f"   Query: '{test_query}'")
    print(f"   Vector dimension: {len(embedding)}")
    print(f"   First 5 values: {embedding[:5]}")
    
    # Test vector search
    print("\n[TEST 3] Testing Vector Search...")
    from qdrant_client.models import QueryRequest
    
    search_results = client.query_points(
        collection_name=QDRANT_COLLECTION_NAME,
        query=embedding,
        limit=3,
        with_payload=True
    )
    
    print(f"✅ Vector search successful!")
    print(f"   Found {len(search_results.points)} results")
    
    for i, point in enumerate(search_results.points, 1):
        print(f"\n   Result {i}:")
        print(f"   - Score: {point.score:.4f}")
        print(f"   - ID: {point.id}")
        payload = point.payload
        print(f"   - Year: {payload.get('year')}")
        print(f"   - Session: {payload.get('session')}")
        print(f"   - Section: {payload.get('section')}")
        print(f"   - Subject: {payload.get('subject')}")
        print(f"   - Type: {payload.get('type')}")
        if 'text' in payload:
            text_preview = payload['text'][:150] + "..." if len(payload.get('text', '')) > 150 else payload.get('text', '')
            print(f"   - Text: {text_preview}")
    
except Exception as e:
    print(f"❌ Qdrant test failed: {str(e)}")
    import traceback
    traceback.print_exc()

# ============================================================================
# Test 4: Neo4j Connection & Graph Structure
# ============================================================================

print("\n" + "=" * 80)
print("[TEST 4] Testing Neo4j Connection & Schema...")
try:
    from config import get_neo4j_graph_store
    
    graph_store = get_neo4j_graph_store()
    
    # Test connection with a simple query
    test_query = "MATCH (n) RETURN count(n) as total_nodes"
    result = graph_store.structured_query(test_query)
    print(f"✅ Connected to Neo4j!")
    print(f"   Total nodes: {result[0]['total_nodes']}")
    
    # Get node labels
    labels_query = "CALL db.labels()"
    labels_result = graph_store.structured_query(labels_query)
    labels = [row['label'] for row in labels_result]
    print(f"   Node labels: {labels}")
    
    # Get relationship types
    rel_query = "CALL db.relationshipTypes()"
    rel_result = graph_store.structured_query(rel_query)
    rel_types = [row['relationshipType'] for row in rel_result]
    print(f"   Relationship types: {rel_types}")
    
    # Sample some nodes
    print("\n[TEST 5] Exploring Graph Structure...")
    
    # Check Exam nodes
    exam_query = """
    MATCH (exam:Exam)
    RETURN exam.year as year, exam.session as session, exam.section as section, exam.subject as subject
    LIMIT 3
    """
    exam_results = graph_store.structured_query(exam_query)
    print(f"\n   Sample Exam nodes:")
    for exam in exam_results:
        print(f"   - Year: {exam.get('year')}, Session: {exam.get('session')}, Section: {exam.get('section')}, Subject: {exam.get('subject')}")
    
    # Check Exercise nodes
    exercise_query = """
    MATCH (exercise:Exercise)
    RETURN exercise.id as id, exercise.exercise_title as title
    LIMIT 3
    """
    exercise_results = graph_store.structured_query(exercise_query)
    print(f"\n   Sample Exercise nodes:")
    for ex in exercise_results:
        print(f"   - ID: {ex.get('id')}, Title: {ex.get('title')}")
    
    # Check Topic nodes
    topic_query = """
    MATCH (topic:Topic)
    RETURN topic.name as name
    LIMIT 5
    """
    topic_results = graph_store.structured_query(topic_query)
    print(f"\n   Sample Topic nodes:")
    for topic in topic_results:
        print(f"   - {topic.get('name')}")
    
    # Check relationships
    rel_structure_query = """
    MATCH (exam:Exam)-[:CONTAINS]->(exercise:Exercise)
    RETURN exam.year as year, exam.subject as subject, count(exercise) as num_exercises
    LIMIT 3
    """
    rel_results = graph_store.structured_query(rel_structure_query)
    print(f"\n   Exam -> Exercise relationships:")
    for rel in rel_results:
        print(f"   - {rel.get('year')} {rel.get('subject')}: {rel.get('num_exercises')} exercises")
    
except Exception as e:
    print(f"❌ Neo4j test failed: {str(e)}")
    import traceback
    traceback.print_exc()

# ============================================================================
# Test 6: Query Exam Graph Function
# ============================================================================

print("\n" + "=" * 80)
print("[TEST 6] Testing query_exam_graph function...")
try:
    from tools import query_exam_graph
    
    # LangChain tools need to be invoked with .invoke() method
    # Pass arguments as a dictionary
    
    # Test 1: Query by year only
    print("\n   Test 6a: Query by year (2017)")
    result = query_exam_graph.invoke({"year": 2017, "limit": 5})
    print(f"   Result: {result[:500]}...")
    
    # Test 2: Query by section and subject
    print("\n   Test 6b: Query by section='math' and subject='math'")
    result = query_exam_graph.invoke({"section": "math", "subject": "math", "limit": 5})
    print(f"   Result: {result[:500]}...")
    
    # Test 3: Query by session
    print("\n   Test 6c: Query by session='principale'")
    result = query_exam_graph.invoke({"session": "principale", "limit": 5})
    print(f"   Result: {result[:500]}...")
    
except Exception as e:
    print(f"❌ query_exam_graph test failed: {str(e)}")
    import traceback
    traceback.print_exc()

# ============================================================================
# Test 7: Search Vectors Function
# ============================================================================

print("\n" + "=" * 80)
print("[TEST 7] Testing search_vectors function...")
try:
    from tools import search_vectors
    
    test_query = "calculus derivatives limits"
    print(f"   Query: '{test_query}'")
    result = search_vectors.invoke({"query": test_query, "limit": 3})
    print(f"   Result: {result[:800]}...")
    
except Exception as e:
    print(f"❌ search_vectors test failed: {str(e)}")
    import traceback
    traceback.print_exc()

# ============================================================================
# Test 8: Content Retrieval Function
# ============================================================================

print("\n" + "=" * 80)
print("[TEST 8] Testing get_content_by_id function...")
try:
    from tools import get_content_by_id, search_vectors
    import ast
    
    # First, get a valid ID from vector search
    search_result = search_vectors.invoke({"query": "mathematics", "limit": 1})
    
    # Parse the string result to get doc_id
    results = ast.literal_eval(search_result)
    if results and len(results) > 0:
        doc_id = results[0]['doc_id']
        print(f"   Testing with ID: {doc_id}")
        
        content = get_content_by_id.invoke({"doc_ids": [doc_id]})
        print(f"   Content length: {len(content)}")
        print(f"   First 300 chars: {content[:300]}...")
    else:
        print("   ⚠️  No documents found in search")
    
except Exception as e:
    print(f"❌ get_content_by_id test failed: {str(e)}")
    import traceback
    traceback.print_exc()

print("\n" + "=" * 80)
print("TESTING COMPLETE")
print("=" * 80)
