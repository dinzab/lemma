# CopilotKit Integration Setup Guide

## ✅ Packages Installed

### Frontend (Next.js)
- `@copilotkit/react-core` - Core hooks and provider
- `@copilotkit/react-ui` - UI components (CopilotSidebar, etc.)
- `@copilotkit/runtime` - Backend runtime
- `@ag-ui/langgraph` - LangGraph agent connector

### Backend (Python Agent)
- `copilotkit==0.1.72` - AG-UI protocol support

---

## 📁 Files Created/Modified

### Created:
1. **`frontend/app/api/copilotkit/route.ts`** - API endpoint connecting to LangGraph agent
2. **`frontend/copilotkit_setup.md`** - This documentation file

### Modified:
1. **`frontend/app/layout.tsx`** - Added CopilotKit provider wrapper
2. **`frontend/app/(dashboard)/new/page.tsx`** - Integrated CoAgent chat interface
3. **`agent/requirements.txt`** - Added copilotkit dependency

---

## 🔧 Environment Variables

### Frontend (`frontend/.env.local`)
Add these to your `.env.local` file:

```bash
# CopilotKit Configuration
LANGGRAPH_DEPLOYMENT_URL=http://localhost:8123

# Optional: LangSmith for debugging
LANGSMITH_API_KEY=your_langsmith_key_here
```

### Backend (`agent/.env`)
Your `.env` should already have:

```bash
OPENAI_API_KEY=your_openai_key_here
```

---

## 🚀 How to Start the Application

### 1. Start the LangGraph Agent Server

Open a terminal in the `agent` directory:

```bash
cd agent

# Activate virtual environment
.venv\Scripts\activate  # Windows
# or
source .venv/bin/activate  # Linux/Mac

# Start the LangGraph development server
langgraph dev --port 8123
```

**Expected output:**
```
- 🚀 API: http://127.0.0.1:8123
```

The agent will be available at `http://localhost:8123`

---

### 2. Start the Next.js Frontend

Open a NEW terminal in the `frontend` directory:

```bash
cd frontend

# Start the Next.js development server
npm run dev
```

**Expected output:**
```
- Local: http://localhost:3000
```

---

## 🧪 Testing the Integration

1. **Navigate to:** `http://localhost:3000/new`
2. **You should see:** The CopilotKit chat sidebar
3. **Try asking:**
   - "What tools do you have access to?"
   - "What's the weather in Paris?"
   - "Tell me a proverb"

---

## 🛠️ Troubleshooting

### Issue: "Cannot connect to agent"
**Solution:** Make sure the LangGraph server is running on port 8123

```bash
# Check if the agent is running
curl http://localhost:8123
```

### Issue: "Module not found: @copilotkit/*"
**Solution:** Reinstall frontend packages

```bash
cd frontend
npm install
```

### Issue: "No module named 'copilotkit'"
**Solution:** Reinstall backend package

```bash
cd agent
.venv\Scripts\activate
pip install copilotkit
```

### Issue: Development console not showing
**Solution:** The dev console only shows in development mode (`NODE_ENV=development`)

---

## 📚 Next Steps

### 1. **Customize the Chat UI**
Edit `frontend/app/(dashboard)/new/page.tsx` to customize:
- Welcome message
- Placeholder text
- Theme colors

### 2. **Add Frontend Actions**
Create tools that the agent can call to update your UI:

```typescript
import { useFrontendTool } from "@copilotkit/react-core";

useFrontendTool({
  name: "show_flashcard",
  description: "Display a flashcard",
  parameters: [
    { name: "question", type: "string" },
    { name: "answer", type: "string" },
  ],
  handler: async ({ question, answer }) => {
    // Update UI state
    setFlashcard({ question, answer });
  },
});
```

### 3. **Add Custom Tools to Agent**
Edit `agent/agent.py` to add more tools:

```python
@tool
def create_flashcard(question: str, answer: str):
    """Create a flashcard for studying."""
    return f"Flashcard created: Q: {question}, A: {answer}"

backend_tools = [
    get_weather,
    create_flashcard,  # Add your new tool
]
```

### 4. **Implement Generative UI**
Render custom React components in the chat:

```typescript
import { useRenderToolCall } from "@copilotkit/react-core";

useRenderToolCall({
  name: "show_study_card",
  render: ({ args, status }) => {
    return <StudyCard data={args} />;
  },
});
```

---

## 📖 Resources

- [CopilotKit Documentation](https://docs.copilotkit.ai/langgraph/quickstart)
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [Example: Research Canvas](https://github.com/CopilotKit/CopilotKit/tree/main/examples/coagents-research-canvas)

---

## ✨ Features Implemented

- ✅ LangGraph Python agent with CopilotKitState
- ✅ Next.js API route connecting to agent
- ✅ CopilotKit provider wrapping the app
- ✅ CoAgent hook for agent communication
- ✅ CopilotSidebar chat interface
- ✅ Development console for debugging
- ✅ Agent state streaming

---

**Happy coding! 🚀**
