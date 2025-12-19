# Agent Architecture Documentation

## Overview
This Tunisian Baccalaureate AI Tutor agent uses LangGraph with CopilotKit integration to provide intelligent educational assistance to students preparing for their Baccalaureate exams.

## File Structure

```
agent/
├── agent.py                # Entry point - exports the compiled graph
├── graph.py                # LangGraph workflow and state management
├── model.py                # Model instantiation (OpenAI, future: Groq, Gemini)
├── tools.py                # Tool definitions (vector search, graph query, content retrieval)
├── system_prompt.py        # Comprehensive system prompt (easily editable)
├── config.py               # Database connections and embedding model
├── test_connections.py     # Test script for database setup
├── requirements.txt        # Python dependencies
├── langgraph.json          # LangGraph configuration
├── .env.example            # Environment variables template
├── DATABASE_SETUP.md       # Detailed database setup guide
└── README.md               # This file
```

## Core Components

### 1. model.py
**Purpose**: Centralized model instantiation for easy switching between providers.

**Current Support**: 
- OpenAI GPT-4o

**Planned Support**:
- Groq
- Google Gemini

**Usage**:
```python
from model import get_model
model = get_model("openai")  # Returns ChatOpenAI instance
```

### 2. tools.py
**Purpose**: Defines backend tools for RAG system access.

**Tools**:
1. `search_vectors(query, limit)` - Semantic search in Qdrant
2. `query_exam_graph(year, session, section, subject, topic, limit)` - Structural filtering in Neo4j
3. `get_content_by_id(doc_ids)` - Retrieve full exam content
4. `get_weather(location)` - Example tool (for testing)

**Current Status**: ✅ **Fully implemented** with real database connections
**Dependencies**: See `config.py` for Qdrant, Neo4j, and embedding setup

### 3. config.py
**Purpose**: Database connections and embedding model configuration.

**Provides**:
- `get_qdrant_client()` - Returns Qdrant client instance
- `get_neo4j_driver()` - Returns Neo4j driver instance
- `embed_query(query)` - Embeds text using sentence-transformers/all-MiniLM-L6-v2
- `QDRANT_COLLECTION_NAME` - Collection name constant

**Usage**:
```python
from config import get_qdrant_client, embed_query
client = get_qdrant_client()
vector = embed_query("complex numbers")
```

### 4. graph.py
**Purpose**: Defines the LangGraph workflow using the ReAct pattern.

**Key Components**:
- `AgentState`: Inherits from `CopilotKitState`, includes `tools` field
- `chat_node`: Main reasoning node that calls the model with tools
- `tool_node`: Executes backend tools
- `route_to_tool_node`: Routing logic for tool calls

**Workflow**:
```
Entry → chat_node → [tool_node → chat_node]* → END
```

### 4. system_prompt.py
**Purpose**: Contains the comprehensive system prompt for the agent.

**Design Principles**:
- Information gathering (ask about section, subject, goals)
- Task decomposition (break complex requests into steps)
- Tool usage strategy (when to use vector search vs. graph query)
- Good/bad examples (demonstrate proper agent behavior)
- Adaptive teaching (adjust to student level)

**Key Sections**:
- Agent capabilities
- Information gathering instructions
- Task decomposition guidelines
- Tool usage strategy
- Explanation quality standards
- Response format

### 5. agent.py
**Purpose**: Clean entry point that exposes the compiled graph.

**Usage**: LangGraph CLI automatically detects and runs this graph.

## RAG System Architecture

### Data Pipeline
1. **OCR**: Marker-PDF extracts text from scanned PDFs
2. **Vision Analysis**: Qwen2-VL-7B generates diagram descriptions
3. **Segmentation**: Llama-3.3-70b identifies exercise boundaries
4. **Embedding**: sentence-transformers/all-MiniLM-L6-v2 (384d)

### Vector Store (Qdrant)
**Collection**: `bac_production_vectors`
**Metadata**:
- `doc_id`: Unique identifier (e.g., 2018_principale_math_math_sujet_ex1)
- `text`: Full exercise content (Text + LaTeX + Image descriptions)
- `year`: Integer (2017-2022)
- `session`: Keyword (principale, controle)
- `section`: Keyword (math, sciences, technique, informatique)
- `subject`: Keyword (math, physique)
- `topic`: Main topic (e.g., Complex Numbers)
- `type`: sujet (Question) or corrige (Solution)

### Graph Database (Neo4j)
**Nodes**:
- `(:Exam)`: Full exam paper
- `(:Exercise)`: Specific problem
- `(:Topic)`: Curriculum topic

**Relationships**:
- `(Exam)-[:CONTAINS]->(Exercise)`
- `(Exercise)-[:COVERS_TOPIC]->(Topic)`

## Database Setup

**📖 See [DATABASE_SETUP.md](./DATABASE_SETUP.md) for complete setup instructions.**

### Quick Start

1. **Install dependencies**:
```bash
cd agent
.venv\Scripts\activate  # Windows
pip install -r requirements.txt
```

2. **Configure environment**:
```bash
cp .env.example .env
# Edit .env with your database credentials
```

3. **Test connections**:
```bash
python test_connections.py
```

Expected output:
```
✅ Qdrant connected successfully!
✅ Neo4j connected successfully!
✅ Embedding model loaded successfully!
```

If tests fail, refer to [DATABASE_SETUP.md](./DATABASE_SETUP.md) for troubleshooting.

## How to Run

### Development Mode
```bash
cd agent
.venv\Scripts\activate  # Windows
langgraph dev --port 8123
```

### Testing
```bash
# Frontend (separate terminal)
cd frontend
npm run dev
```

Navigate to `http://localhost:3000/c/[id]` to test the chat interface.

## Next Steps

1. **Implement Tool Logic**:
   - Connect to Qdrant client
   - Connect to Neo4j client
   - Replace placeholder logic in `tools.py`

2. **Frontend Integration**:
   - Wire up `useCopilotChat.append()` to send messages
   - Implement `/new` → `/c/[id]` redirect with unique IDs

3. **Advanced Features**:
   - Generative UI for flashcards/quizzes
   - Human-in-the-loop for critical decisions
   - Chat history persistence

## Environment Variables

Required in `agent/.env`:
```bash
OPENAI_API_KEY=your_openai_key_here
```

Required in `frontend/.env.local`:
```bash
LANGGRAPH_DEPLOYMENT_URL=http://localhost:8123
```

## CopilotKit Integration

The agent is fully integrated with CopilotKit:
- `AgentState` extends `CopilotKitState`
- Frontend tools accessible via `state.get("tools", [])`
- API endpoint at `/api/copilotkit` in Next.js
- Provider scoped to `/c/[id]` pages for performance

## Resources

- [LangGraph Docs](https://langchain-ai.github.io/langgraph/)
- [CopilotKit LangGraph Guide](https://docs.copilotkit.ai/langgraph/quickstart)
- [Prompt Engineering Guide](https://github.com/dair-ai/prompt-engineering-guide)
