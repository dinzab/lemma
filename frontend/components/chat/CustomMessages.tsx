"use client";

import { useState } from "react";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { Sparkles, RefreshCw, ChevronRight } from "lucide-react";
import { ThinkingRenderer, parseThinkingContent } from "@/components/chat/ThinkingRenderer";
import { Button } from "@/components/ui/button";

// Message types for pure LangGraph integration
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string; // For tool result messages - links to the original tool call
  toolName?: string;   // Name of the tool that was called
}

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
  result?: unknown;
  status?: 'pending' | 'executing' | 'complete' | 'error';
}

type ToolResultItem = {
  doc_id?: string;
  exercise_id?: string;
  id?: string;
  text?: string;
  content?: string;
  year?: string | number;
  session?: string;
  section?: string;
  subject?: string;
  topic?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toToolResultItem(value: unknown): ToolResultItem {
  return isRecord(value) ? value : {};
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (isRecord(part) && part.type === 'text' ? getString(part.text) : undefined))
      .filter((text): text is string => Boolean(text))
      .join('\n');
  }
  return '';
}

interface UserMessageProps {
  message: Message;
}

interface AssistantMessageProps {
  message: Message;
  isLoading?: boolean;
  isLastMessage?: boolean;
  onRegenerate?: (messageId: string) => void;
}

export const CustomUserMessage = ({ message }: UserMessageProps) => {
  const textContent = extractTextContent(message.content);
  
  return (
    <div className="mb-4 flex justify-end">
      <div className="max-w-[85%] rounded-xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm font-medium leading-relaxed text-primary-foreground shadow-sm shadow-primary/20">
        {textContent}
      </div>
    </div>
  );
};

const ToolCallDisplay = ({ toolCalls }: { toolCalls: ToolCall[] }) => {
  if (!toolCalls || toolCalls.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 mb-3">
      {toolCalls.map((call) => (
        <SingleToolCall key={call.id} call={call} />
      ))}
    </div>
  );
};

const SingleToolCall = ({ call }: { call: ToolCall }) => {
  const [isOpen, setIsOpen] = useState(!call.result); // Auto-expand when executing
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const isExecuting = call.status === 'executing';
  const isComplete = call.status === 'complete';

  const toggleItemExpanded = (idx: number) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(idx)) {
        newSet.delete(idx);
      } else {
        newSet.add(idx);
      }
      return newSet;
    });
  };

  // Format args for display
  const formatArgs = () => {
    if (!call.args) return null;
    try {
      const parsed = typeof call.args === 'string' ? JSON.parse(call.args) : call.args;
      if (!isRecord(parsed)) return <span className="opacity-70">{String(call.args)}</span>;
      return Object.entries(parsed).map(([key, value]) => (
        <span key={key} className="inline-flex gap-1 mr-3">
          <span className="text-muted-foreground/50">{key}:</span>
          <span className="text-foreground/70">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
        </span>
      ));
    } catch {
      return <span className="opacity-70">{String(call.args)}</span>;
    }
  };

  // Parse and format result for display
  const formatResult = () => {
    if (!call.result) return null;
    
    const content = typeof call.result === 'object' ? JSON.stringify(call.result) : String(call.result);
    
    // Try to parse as JSON array (common format for tool results)
    if (content.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          return (
            <div className="space-y-3 mt-3">
              {parsed.map((rawItem: unknown, idx: number) => {
                const item = toToolResultItem(rawItem);
                const isItemExpanded = expandedItems.has(idx);
                const text = getString(item.text) ?? "";
                const hasLongText = text.length > 200;
                
                return (
                  <div 
                    key={idx} 
                    className="rounded-lg bg-background/60 border border-border/40 overflow-hidden hover:border-primary/30 transition-colors"
                  >
                    {/* Card Header */}
                    <div className="p-3 pb-2">
                      <div className="flex items-start gap-3">
                        {/* Number badge */}
                        <span className="text-xs font-bold text-primary bg-primary/10 h-6 w-6 rounded-md flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        
                        <div className="flex-1 min-w-0">
                          {/* Title */}
                          <div className="font-semibold text-foreground text-sm mb-1.5">
                            {item.doc_id || item.exercise_id || item.id || `Result ${idx + 1}`}
                          </div>
                          
                          {/* Metadata badges */}
                          <div className="flex flex-wrap gap-1.5">
                            {item.year && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                                {item.year}
                              </span>
                            )}
                            {item.session && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
                                {item.session}
                              </span>
                            )}
                            {item.section && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                {item.section}
                              </span>
                            )}
                            {item.subject && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                {item.subject}
                              </span>
                            )}
                            {item.topic && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/5 text-primary font-medium">
                                📚 {item.topic}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Content area with markdown */}
                    {text && (
                      <div className="px-3 pb-3">
                        <div 
                          className={`text-sm text-foreground/80 leading-relaxed ${!isItemExpanded && hasLongText ? 'line-clamp-4' : ''}`}
                        >
                          <MarkdownRenderer content={isItemExpanded ? text : text.slice(0, 400) + (hasLongText && !isItemExpanded ? '...' : '')} />
                        </div>
                        
                        {/* Expand/Collapse button */}
                        {hasLongText && (
                          <button
                            onClick={() => toggleItemExpanded(idx)}
                            className="mt-2 text-xs text-primary hover:text-primary/80 font-medium flex items-center gap-1 transition-colors"
                          >
                            {isItemExpanded ? (
                              <>
                                <ChevronRight className="h-3 w-3 rotate-90" />
                                Show less
                              </>
                            ) : (
                              <>
                                <ChevronRight className="h-3 w-3" />
                                Read full exercise
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        }
      } catch {
        // Fall through to default formatting
      }
    }
    
    // Try to parse as JSON object
    if (content.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(content);
        return (
          <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap break-words bg-muted/30 p-3 rounded-lg mt-2">
            {JSON.stringify(parsed, null, 2)}
          </pre>
        );
      } catch {
        // Fall through
      }
    }
    
    // Default: plain text with markdown
    return (
      <div className="text-sm text-foreground/80 mt-2">
        <MarkdownRenderer content={content} />
      </div>
    );
  };

  const resultCount = (() => {
    if (!call.result) return 0;
    try {
      const content = typeof call.result === 'object' ? JSON.stringify(call.result) : String(call.result);
      if (content.trim().startsWith('[')) {
        return JSON.parse(content).length;
      }
    } catch {
      return 0;
    }
    return 0;
  })();

  return (
    <div className="rounded-lg border border-border/40 bg-muted/20 overflow-hidden">
      {/* Header - Clickable */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full p-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-all duration-200"
      >
        <div className={`transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}>
          <ChevronRight className="h-3.5 w-3.5" />
        </div>
        
        {/* Status indicator - using primary color */}
        <div className={`h-2 w-2 rounded-full ${isExecuting ? 'bg-primary animate-pulse' : (isComplete ? 'bg-primary' : 'bg-muted-foreground/50')}`} />
        
        {/* Tool name */}
        <span className={`font-semibold ${isExecuting ? 'text-primary' : 'text-foreground/80'}`}>
          {call.name}
        </span>
        
        {/* Args preview (inline) */}
        <span className="flex-1 text-left text-[10px] text-muted-foreground/60 truncate font-mono">
          {formatArgs()}
        </span>
        
        {/* Right side status */}
        <div className="flex items-center gap-2 ml-auto shrink-0">
          {isExecuting && (
            <RefreshCw className="h-3 w-3 animate-spin text-primary/70" />
          )}
          {isComplete && resultCount > 0 && (
            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-semibold">
              {resultCount} {resultCount === 1 ? 'result' : 'results'}
            </span>
          )}
          {isComplete && (
            <svg className="h-3.5 w-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      </button>
      
      {/* Expandable content */}
      {isOpen && (
        <div className="px-3 pb-3 border-t border-border/30 bg-background/30 animate-in slide-in-from-top-2 fade-in duration-200">
          {/* Results section */}
          {isComplete && call.result ? (
            formatResult()
          ) : isExecuting ? (
            <div className="flex items-center gap-2 text-muted-foreground/70 text-xs py-3">
              <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              <span>Executing tool...</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export const CustomToolMessage = ({ message }: { message: Message }) => {
  const content = typeof message.content === 'object' ? JSON.stringify(message.content, null, 2) : message.content;
  const isJson = content.trim().startsWith('[') || content.trim().startsWith('{');
  const toolName = message.toolName || 'Tool';
  
  // Try to parse and format the result nicely
  let formattedResult = content;
  let resultCount = 0;
  
  if (isJson) {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        resultCount = parsed.length;
        // Show a summary instead of raw JSON
        formattedResult = parsed.map((rawItem: unknown, idx: number) => {
          const item = toToolResultItem(rawItem);
          const preview = item.text ?? item.content ?? JSON.stringify(rawItem);
          return `${idx + 1}. ${item.doc_id || item.id || 'Result'}: ${preview.slice(0, 100)}...`;
        }
        ).join('\n');
      }
    } catch {
      formattedResult = content.slice(0, 500) + (content.length > 500 ? "..." : "");
    }
  }
  
  return (
    <div className="flex gap-3 mb-4 group ml-11">
      <div className="flex-1 min-w-0">
        {/* Tool Execution Header */}
        <div className="flex items-center gap-2 mb-2">
          <div className="h-5 w-5 rounded bg-green-500/20 flex items-center justify-center">
            <svg className="h-3 w-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <span className="text-xs font-semibold text-green-500">{toolName}</span>
          {resultCount > 0 && (
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {resultCount} result{resultCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        
        {/* Result Content */}
        <div className="text-xs font-mono bg-muted/30 p-3 rounded-md overflow-x-auto max-w-full border border-border/30">
          <pre className="whitespace-pre-wrap break-words text-muted-foreground">
            {formattedResult}
          </pre>
        </div>
      </div>
    </div>
  );
};

export const CustomAssistantMessage = ({ 
  message, 
  isLoading = false, 
  isLastMessage = false,
  onRegenerate 
}: AssistantMessageProps) => {
  const textContent = extractTextContent(message.content);
  
  // Parse thinking content if present
  const { thinking, content: cleanContent, isComplete } = parseThinkingContent(textContent);

  // Handle empty state (no content, no thinking, no tool calls, not loading)
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;
  if (!cleanContent && !thinking && !isLoading && !hasToolCalls) {
    return null;
  }

  // Determine if we should show a placeholder thinking state
  const showPlaceholderThinking = isLoading && !thinking && !cleanContent;

  return (
    <div className="group mb-6 flex gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-primary/10">
        <Sparkles className="h-4 w-4 text-primary" />
      </div>
      
      <div className="min-w-0 flex-1 space-y-2">
        {/* Render Thinking Process */}
        {(thinking || showPlaceholderThinking) && (
          <div className="mb-2">
            <ThinkingRenderer 
              content={thinking} 
              isComplete={showPlaceholderThinking ? false : isComplete}
              isLoading={isLoading}
            />
          </div>
        )}

        {/* Live Tool Calls Rendering */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <ToolCallDisplay toolCalls={message.toolCalls} />
        )}

        {/* Render Main Content */}
        {(cleanContent || (isLoading && (!thinking || isComplete) && !showPlaceholderThinking)) && (
          <div className="rounded-xl border bg-card/75 px-4 py-3 text-sm leading-relaxed text-card-foreground shadow-sm">
            {cleanContent && <MarkdownRenderer content={cleanContent} />}
            {isLoading && !cleanContent && (
              <span className="inline-block w-2 h-4 bg-primary/50 animate-pulse rounded ml-1 align-middle" />
            )}
          </div>
        )}

        {/* Regenerate Button - Show only when not loading and is the last message */}
        {!isLoading && isLastMessage && onRegenerate && (
          <div className="flex items-center gap-2 mt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRegenerate(message.id)}
              className="h-6 px-2 text-[10px] text-muted-foreground hover:text-primary hover:bg-primary/5"
            >
              <RefreshCw className="h-3 w-3 mr-1.5" />
              Regenerate
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
