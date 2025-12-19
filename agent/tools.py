from langchain.tools import tool
from typing import List, Optional, Dict, Any
import json
from config import (
    get_qdrant_client,
    get_neo4j_graph_store,
    embed_query,
    QDRANT_COLLECTION_NAME
)

@tool
def search_vectors(query: str, limit: int = 5) -> str:
    """
    Queries Qdrant for semantic matches to find exercises by concept or description.
    Useful for finding relevant exercises based on a natural language query.
    
    Args:
        query: Natural language query (e.g., "complex numbers problems involving modulus")
        limit: Maximum number of results to return (default: 5)
    
    Returns:
        JSON string with search results
    """
    try:
        # Get Qdrant client and embed the query
        client = get_qdrant_client()
        query_vector = embed_query(query)
        
        # Search in Qdrant using query_points (correct API)
        response = client.query_points(
            collection_name=QDRANT_COLLECTION_NAME,
            query=query_vector,
            limit=limit,
            with_payload=True
        )
        
        # Format results - response.points contains the actual results
        formatted_results = []
        for point in response.points:
            payload = point.payload
            formatted_results.append({
                "doc_id": payload.get("doc_id"),
                "text": payload.get("text", "")[:500] + "...",  # First 500 chars
                "year": payload.get("year"),
                "session": payload.get("session"),
                "section": payload.get("section"),
                "subject": payload.get("subject"),
                "topic": payload.get("topic"),
                "type": payload.get("type"),
                "score": point.score
            })
        
        return json.dumps(formatted_results, ensure_ascii=False)
    
    except Exception as e:
        return f"Error searching vectors: {str(e)}"

@tool
def query_exam_graph(
    year: Optional[int] = None,
    session: Optional[str] = None,
    section: Optional[str] = None,
    subject: Optional[str] = None,
    topic: Optional[str] = None,
    limit: int = 10
) -> str:
    """
    Queries Neo4j to find specific exams/exercises based on metadata filters.
    Useful for structured navigation like finding all 'Math' exams from '2020'.
    
    Args:
        year: Year of the exam (e.g., 2018, 2019)
        session: Session type ('principale' or 'controle')
        section: Section ('math', 'sciences', 'technique', 'informatique')
        subject: Subject ('math', 'physique', etc.)
        topic: Topic name (e.g., 'Complex Numbers', 'Probability')
        limit: Maximum number of results (default: 10)
    
    Returns:
        JSON string with matching exercise IDs and metadata
    """
    try:
        graph_store = get_neo4j_graph_store()
        
        # Build Cypher query dynamically based on provided filters
        conditions = []
        params = {"limit": limit}
        
        # Note: Based on Neo4j schema, we need to check actual property names
        # The graph has: Exam, Exercise, Topic, SubTopic nodes
        # Relationships: CONTAINS, COVERS_TOPIC, COVERS_SUBTOPIC
        
        if year:
            conditions.append("exam.year = $year")
            params["year"] = year
        if session:
            conditions.append("exam.session = $session")
            params["session"] = session
        if section:
            conditions.append("exam.section = $section")
            params["section"] = section
        if subject:
            conditions.append("exam.subject = $subject")
            params["subject"] = subject
        
        # Build WHERE clause
        where_clause = " AND ".join(conditions) if conditions else "1=1"
        
        # Build query based on whether topic filter is provided
        if topic:
            # Query with topic filter
            cypher_query = f"""
            MATCH (exam:Exam)-[:CONTAINS]->(exercise:Exercise)
            WHERE {where_clause}
            OPTIONAL MATCH (exercise)-[:COVERS_TOPIC]->(t:Topic)
            WHERE t.name = $topic OR t.name CONTAINS $topic
            WITH exam, exercise, t
            WHERE t IS NOT NULL
            RETURN 
                exercise.id AS exercise_id,
                exercise.exercise_title AS exercise_title,
                exam.year AS year, 
                exam.session AS session,
                exam.section AS section, 
                exam.subject AS subject,
                t.name AS topic
            LIMIT $limit
            """
            params["topic"] = topic
        else:
            # Query without topic filter - return all matching exercises
            cypher_query = f"""
            MATCH (exam:Exam)-[:CONTAINS]->(exercise:Exercise)
            WHERE {where_clause}
            OPTIONAL MATCH (exercise)-[:COVERS_TOPIC]->(t:Topic)
            RETURN 
                exercise.id AS exercise_id,
                exercise.exercise_title AS exercise_title,
                exam.year AS year, 
                exam.session AS session,
                exam.section AS section, 
                exam.subject AS subject,
                collect(DISTINCT t.name)[0] AS topic
            LIMIT $limit
            """
        
        # Execute query using LlamaIndex graph store
        records = graph_store.structured_query(cypher_query, param_map=params)
        
        if not records or len(records) == 0:
            return "No matching exercises found for the given criteria."
        
        # Format results for better readability
        formatted_results = []
        for record in records:
            formatted_results.append({
                "exercise_id": record.get("exercise_id"),
                "exercise_title": record.get("exercise_title"),
                "year": record.get("year"),
                "session": record.get("session"),
                "section": record.get("section"),
                "subject": record.get("subject"),
                "topic": record.get("topic")
            })
        
        return json.dumps(formatted_results, ensure_ascii=False)
    
    except Exception as e:
        return f"Error querying graph: {str(e)}"


@tool
def get_content_by_id(doc_ids: List[str]) -> str:
    """
    Fetches the full text payload from Qdrant for specific document IDs.
    Used after finding relevant IDs via Graph or Vector search to get the actual content.
    
    Args:
        doc_ids: List of document IDs to retrieve (e.g., ['2018_principale_math_math_sujet_ex1'])
    
    Returns:
        JSON string with full content for each ID
    """
    try:
        from qdrant_client.models import Filter, FieldCondition, MatchAny
        
        client = get_qdrant_client()
        
        # Use scroll with filter to get points by doc_id field
        # Note: doc_id is in the payload, not the point ID itself
        results, _ = client.scroll(
            collection_name=QDRANT_COLLECTION_NAME,
            scroll_filter=Filter(
                must=[
                    FieldCondition(
                        key="doc_id",
                        match=MatchAny(any=doc_ids)
                    )
                ]
            ),
            limit=len(doc_ids),
            with_payload=True,
            with_vectors=False
        )
        
        # Format results with full content
        formatted_results = []
        for point in results:
            payload = point.payload
            formatted_results.append({
                "doc_id": payload.get("doc_id"),
                "text": payload.get("text"),  # Full text
                "year": payload.get("year"),
                "session": payload.get("session"),
                "section": payload.get("section"),
                "subject": payload.get("subject"),
                "topic": payload.get("topic"),
                "type": payload.get("type")
            })
        
        if not formatted_results:
            return f"No content found for IDs: {doc_ids}"
        
        return json.dumps(formatted_results, ensure_ascii=False)
    
    except Exception as e:
        return f"Error retrieving content: {str(e)}"

backend_tools = [
    search_vectors,
    query_exam_graph,
    get_content_by_id
]

