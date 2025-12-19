# Tool Call Rendering in Custom Chat UI

This document explains how backend tool calls are rendered in the custom chat interface with real-time execution status.

## Architecture Overview

```
User Message → Agent Processes → Tool Calls → Tool Execution → Results → Display
```

### Flow:
1. **User sends message** → LangGraph agent receives it
2. **Agent decides to use tools** → Creates `ActionExecutionMessage` with `toolCalls`
3. **Frontend detects tool calls** → Renders with `ToolCallRenderer`
4. **Tool executes** → Status updates: `pending` → `executing` → `complete`
5. **Results displayed** → Shown in chat as tool result messages

---

## Message Types

CopilotKit messages can be one of several types. Here are the key ones for tool rendering:

### 1. **TextMessage** (User/Assistant)
```typescript
{
  role: "user" | "assistant",
  content: "Message text",
  id: "msg_123"
}
```

### 2. **ActionExecutionMessage** (Tool Calls)
```typescript
{
  role: "assistant",
  content: "", // Usually empty
  toolCalls: [
    {
      id: "call_abc123",
      function: {
        name: "search_vectors",
        arguments: '{"query": "derivatives", "limit": 5}'
      },
      status: "pending" | "executing" | "complete" | "error"
    }
  ]
}
```

### 3. **ResultMessage** (Tool Results)
```typescript
{
  role: "tool",
  content: "[{...}]", // Tool's return value
  name: "search_vectors",
  callId: "call_abc123"
}
```

---

## Tool Call Detection

In `app/(dashboard)/c/[id]/page.tsx`, we check each message:

```typescript
const hasToolCalls = "toolCalls" in message && Array.isArray(message.toolCalls);

if (hasToolCalls) {
  message.toolCalls.map((toolCall) => {
    // Render each tool call with ToolCallRenderer
  });
}
```

---

## ToolCallRenderer Component

Located in `components/chat/ToolCallRenderer.tsx`

### Props:
```typescript
interface ToolCallProps {
  toolName: string;              // e.g., "search_vectors"
  args: Record<string, any>;     // Tool arguments
  status: "pending" | "executing" | "complete" | "error";
  result?: string;               // Optional result preview
}
```

### Supported Tools:

#### 1. **search_vectors**
- **Icon**: 🔍 Search
- **Color**: Blue
- **Description**: Shows the search query
- **Example**: `Finding exercises for: "derivatives"`

#### 2. **query_exam_graph**
- **Icon**: 💾 Database
- **Color**: Purple
- **Description**: Shows active filters (year, section, subject, topic)
- **Example**: `Year: 2017, Section: math, Subject: math`

#### 3. **get_content_by_id**
- **Icon**: 📄 FileText
- **Color**: Green
- **Description**: Shows number of documents being fetched
- **Example**: `Fetching 3 documents`

---

## Execution Status Indicators

### Visual States:

| Status | Indicator | Description |
|--------|-----------|-------------|
| **Pending** | 🔵 Pulsing dot | Tool call queued, not started |
| **Executing** | ⏳ Spinning loader | Tool currently running |
| **Complete** | ✅ Check mark | Tool finished successfully |
| **Error** | ❌ Red dot | Tool execution failed |

### Color Coding:
- Each tool has its own color scheme (blue/purple/green)
- Status indicators override tool colors when complete/error
- Smooth transitions between states

---

## Example Renders

### 1. Vector Search (Executing)
```
┌───────────────────────────────────────────────┐
│ 🔍 Searching vectors          [ ⏳ Running ] │
│ Finding exercises for: "introduction to derivatives" │
└───────────────────────────────────────────────┘
```

### 2. Graph Query (Complete)
```
┌───────────────────────────────────────────────┐
│ 💾 Querying exam database     [ ✅ Complete ]│
│ Year: 2017, Section: math, Subject: math     │
│ ────────────────────────────────────────      │
│ [{'exercise_id': '2017_principale...          │
└───────────────────────────────────────────────┘
```

### 3. Content Retrieval (Pending)
```
┌───────────────────────────────────────────────┐
│ 📄 Retrieving content         [ 🔵 Pending ] │
│ Fetching 2 documents                          │
└───────────────────────────────────────────────┘
```

---

## Styling & Customization

### Theme Support:
- ✅ Dark mode compatible
- ✅ Uses CSS variables from `globals.css`
- ✅ Consistent with warm color palette

### Responsive Design:
- Mobile: Stacks vertically, 100% width
- Desktop: Max width 80%, side-aligned

### Customization:
To add a new tool, update `TOOL_CONFIG` in `ToolCallRenderer.tsx`:

```typescript
new_tool_name: {
  icon: YourIcon,
  color: "text-color-500",
  bgColor: "bg-color-50 dark:bg-color-950/30",
  borderColor: "border-color-200 dark:border-color-800",
  label: "Your Tool Label",
  description: (args) => `Your description with ${args.param}`,
}
```

---

## Integration with LangGraph Agent

### Backend (Python)
Tools are automatically detected when decorated with `@tool`:

```python
from langchain.tools import tool

@tool
def search_vectors(query: str, limit: int = 5) -> str:
    """Tool docstring"""
    # Implementation
    return str(results)
```

### Frontend (Next.js)
No additional configuration needed! CopilotKit automatically:
1. Captures tool calls from agent
2. Adds them to message stream
3. Updates status as tool executes
4. Returns results in subsequent messages

---

## Real-Time Updates

Tool status updates happen automatically through CopilotKit's streaming:

```
User: "Find me 2017 math exercises"
  ↓
Agent: [Decides to use query_exam_graph]
  ↓
Frontend: Shows "Pending" badge
  ↓
Backend: Tool starts execution
  ↓
Frontend: Updates to "Running" with spinner
  ↓
Backend: Tool completes
  ↓
Frontend: Shows "Complete" with checkmark
  ↓
Agent: Uses results to formulate response
```

---

## Debugging

### Enable Dev Mode
In `.env.local`:
```bash
NODE_ENV=development
```

### Check Message Structure
Add console logging in chat page:
```typescript
console.log("Message:", message);
console.log("Has tool calls:", hasToolCalls);
console.log("Tool calls:", message.toolCalls);
```

### Common Issues

**Tool calls not appearing:**
- ✅ Check agent is using `@tool` decorator
- ✅ Verify agent is registered in LangGraph
- ✅ Ensure `/api/copilotkit` route is working

**Status stuck on "Pending":**
- ✅ Check LangGraph server is running (`localhost:8123`)
- ✅ Verify tool execution completes successfully
- ✅ Check browser console for errors

**Styling issues:**
- ✅ Ensure Tailwind classes are not purged
- ✅ Check dark mode provider is active
- ✅ Verify icon imports from `lucide-react`

---

## Performance Considerations

### Optimization Tips:
1. **Lazy Rendering**: Only render visible messages
2. **Memoization**: Use `React.memo` for ToolCallRenderer
3. **Virtual Scrolling**: For conversations with 100+ messages
4. **Debounce Status Updates**: Avoid excessive re-renders

### Memory Management:
- Tool results are strings (capped at reasonable length)
- Old messages can be archived to database
- Clear chat history beyond 50 messages

---

## Future Enhancements

### Planned Features:
- [ ] Expandable tool results (click to see full output)
- [ ] Copy tool arguments to clipboard
- [ ] Retry failed tool executions
- [ ] Tool execution timing metrics
- [ ] Interactive parameter editing (Human-in-the-Loop)

### UI Improvements:
- [ ] Animated transitions between status states
- [ ] Progress bars for long-running tools
- [ ] Collapsible tool call groups
- [ ] Syntax highlighting for JSON results

---

## Related Files

- **Chat Page**: `frontend/app/(dashboard)/c/[id]/page.tsx`
- **Tool Renderer**: `frontend/components/chat/ToolCallRenderer.tsx`
- **Backend Tools**: `agent/tools.py`
- **Agent Graph**: `agent/graph.py`
- **CopilotKit Route**: `frontend/app/api/copilotkit/route.ts`

---

## Resources

- [CopilotKit Docs - Generative UI](https://docs.copilotkit.ai/langgraph/generative-ui/backend-tools)
- [CopilotKit Docs - Headless UI](https://docs.copilotkit.ai/custom-look-and-feel/headless-ui)
- [LangChain Tools Documentation](https://python.langchain.com/docs/modules/agents/tools/)
- [LangGraph Tool Execution](https://langchain-ai.github.io/langgraph/concepts/low_level/#tools)
