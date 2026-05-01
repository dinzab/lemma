"use client";

import { useState } from "react";
import { Search, Database, FileText, Loader2, ChevronDown, AlertCircle } from "lucide-react";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";

/**
 * Tool Call Renderer Component
 * 
 * Renders the UI for backend tool calls with execution status
 * and structured data display, matching the warm theme.
 */

interface ToolCallProps {
  toolName: string;
  args: Record<string, unknown>;
  status: "pending" | "executing" | "complete" | "error";
  result?: string;
}

type ToolArgs = Record<string, unknown>;

type ToolResultItem = {
  doc_id?: string;
  exercise_id?: string;
  id?: string;
  text?: string;
  topic?: string;
  subject?: string;
  section?: string;
  session?: string;
  year?: string | number;
  score?: number;
};

const getString = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

const getStringList = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const TOOL_CONFIG = {
  search_vectors: {
    icon: Search,
    label: "Searching Knowledge Base",
    description: (args: ToolArgs) => `Finding content related to: "${getString(args.query, "your question")}"`,
  },
  query_exam_graph: {
    icon: Database,
    label: "Querying Exam Database",
    description: (args: ToolArgs) => {
      const filters = [];
      if (args.year) filters.push(`Year: ${args.year}`);
      if (args.section) filters.push(`Section: ${args.section}`);
      if (args.subject) filters.push(`Subject: ${args.subject}`);
      if (args.topic) filters.push(`Topic: ${args.topic}`);
      return filters.length > 0 ? filters.join(" • ") : "Searching all exams";
    },
  },
  get_content_by_id: {
    icon: FileText,
    label: "Retrieving Exercise Content",
    description: (args: ToolArgs) => {
      const ids = getStringList(args.doc_ids);
      return `Fetching ${ids.length} document${ids.length !== 1 ? "s" : ""}`;
    },
  },
};

export function ToolCallRenderer({ toolName, args, status, result }: ToolCallProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  
  const config = TOOL_CONFIG[toolName as keyof typeof TOOL_CONFIG] || {
    icon: FileText,
    label: toolName,
    description: () => JSON.stringify(args),
  };

  const Icon = config.icon;

  // Skeleton loading components
  const SkeletonCard = () => (
    <div className="bg-card rounded-lg border border-border/50 overflow-hidden shadow-sm animate-pulse">
      <div className="bg-muted/30 px-3 py-2 border-b border-border/30">
        <div className="h-4 bg-muted-foreground/20 rounded w-1/3"></div>
      </div>
      <div className="p-3 space-y-2">
        <div className="h-3 bg-muted-foreground/20 rounded w-full"></div>
        <div className="h-3 bg-muted-foreground/20 rounded w-5/6"></div>
        <div className="h-3 bg-muted-foreground/20 rounded w-4/6"></div>
      </div>
    </div>
  );

  const HorizontalSkeletonCard = () => (
    <div className="flex-shrink-0 w-72 bg-card rounded-lg border border-border/50 shadow-sm animate-pulse">
      <div className="p-4 space-y-3">
        <div className="h-4 bg-muted-foreground/20 rounded w-2/3"></div>
        <div className="space-y-2">
          <div className="h-3 bg-muted-foreground/20 rounded w-1/2"></div>
          <div className="h-3 bg-muted-foreground/20 rounded w-3/4"></div>
        </div>
      </div>
    </div>
  );

  // Parse result if available
  let parsedResult: unknown = null;
  if (result && status === "complete") {
    try {
      parsedResult = JSON.parse(result);
    } catch {
      parsedResult = result;
    }
  }

  const formatExerciseId = (id: string) => {
    if (!id) return "Unknown Exercise";
    const parts = id.split('_');
    const exPart = parts.find(p => p.startsWith('ex'));
    const year = parts[0];
    const session = parts[1];
    
    if (exPart && year && session) {
      const exNum = exPart.replace('ex', '');
      return `Exercise ${exNum} • ${year} ${session.charAt(0).toUpperCase() + session.slice(1)}`;
    }
    return id.split('_').join(' ');
  };

  const renderResultContent = () => {
    if (!result) return null;

    let parsedResult;
    try {
      parsedResult = JSON.parse(result);
    } catch {
      return <p className="text-sm text-muted-foreground">Failed to parse result</p>;
    }

    if (Array.isArray(parsedResult) && parsedResult.length === 0) {
      return (
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <AlertCircle className="h-4 w-4" />
          No results found for this query.
        </div>
      );
    }

    // 1. Exam Database - show skeleton during execution
    if (toolName === "query_exam_graph" && Array.isArray(parsedResult)) {
      if (status === "executing") {
        return (
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
            {[1, 2, 3].map((i) => (
              <HorizontalSkeletonCard key={i} />
            ))}
          </div>
        );
      }

      return (
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent min-h-[180px]">
          {parsedResult.map((item: ToolResultItem, idx: number) => (
            <div 
              key={idx} 
              className="flex-shrink-0 w-72 bg-card rounded-lg border border-border/50 shadow-sm hover:border-primary/30 hover:shadow-md transition-all cursor-pointer animate-in slide-in-from-left-4 fade-in"
              style={{ animationDelay: `${idx * 50}ms`, animationDuration: '300ms', animationFillMode: 'backwards' }}
            >
              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full group-hover:bg-primary/20 transition-colors">
                    {item.year}
                  </span>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                    {item.session}
                  </span>
                </div>
                
                <div className="space-y-1">
                  <div className="text-sm font-medium text-foreground line-clamp-2 leading-tight">
                    {item.topic || "General Topic"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {item.subject} • {item.section}
                  </div>
                </div>

                <div className="mt-auto pt-2 border-t border-border/30 flex justify-between items-center">
                  <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[150px]" title={item.exercise_id}>
                    {formatExerciseId(item.exercise_id ?? item.id ?? "")}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    }

    // 2. Vector Search - show skeleton during execution
    if (toolName === "search_vectors" && Array.isArray(parsedResult)) {
      if (status === "executing") {
        return (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        );
      }

      return (
        <div className="space-y-3 min-h-[150px]">
          {parsedResult.map((item: ToolResultItem, idx: number) => (
            <div 
              key={idx} 
              className="bg-card rounded-lg border border-border/50 overflow-hidden shadow-sm hover:border-primary/20 transition-colors animate-in fade-in slide-in-from-bottom-2"
              style={{ animationDelay: `${idx * 50}ms`, animationDuration: '300ms', animationFillMode: 'backwards' }}
            >
              <div className="bg-muted/30 px-3 py-2 border-b border-border/30 flex justify-between items-center">
                <span className="text-xs font-medium text-foreground/80">
                  {formatExerciseId(item.doc_id ?? item.id ?? "")}
                </span>
                {item.score && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-background border border-border/50 text-muted-foreground">
                    {Math.round(item.score * 100)}% match
                  </span>
                )}
              </div>
              <div className="p-3 text-sm text-foreground/90 max-h-60 overflow-y-auto custom-scrollbar">
                <MarkdownRenderer content={item.text ?? ""} />
              </div>
            </div>
          ))}
        </div>
      );
    }

    // 3. Content Retrieval - show skeleton during execution
    if (toolName === "get_content_by_id" && Array.isArray(parsedResult)) {
      if (status === "executing") {
        return (
          <div className="space-y-4">
            <SkeletonCard />
          </div>
        );
      }

      return (
        <div className="space-y-4 min-h-[150px]">
          {parsedResult.map((item: ToolResultItem, idx: number) => (
            <div 
              key={idx} 
              className="bg-card rounded-lg border border-border/50 shadow-sm animate-in fade-in slide-in-from-bottom-2"
              style={{ animationDelay: `${idx * 50}ms`, animationDuration: '300ms', animationFillMode: 'backwards' }}
            >
              <div className="bg-primary/5 px-4 py-3 border-b border-border/30">
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  {formatExerciseId(item.doc_id ?? item.id ?? "")}
                </h4>
                <div className="flex gap-2 mt-1 text-xs text-muted-foreground">
                  <span className="bg-background/50 px-1.5 py-0.5 rounded border border-border/20">{item.year}</span>
                  <span className="bg-background/50 px-1.5 py-0.5 rounded border border-border/20">{item.session}</span>
                  <span className="bg-background/50 px-1.5 py-0.5 rounded border border-border/20">{item.section}</span>
                </div>
              </div>
              <div className="p-4 text-sm text-foreground/90">
                <MarkdownRenderer content={item.text ?? ""} />
              </div>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="bg-muted/20 rounded-md border border-border/40 p-3 overflow-x-auto">
        <pre className="text-xs font-mono text-muted-foreground">
          {typeof parsedResult === 'object' ? JSON.stringify(parsedResult, null, 2) : parsedResult}
        </pre>
      </div>
    );
  };

  return (
    <div className="w-full rounded-xl border border-border/60 bg-background/50 overflow-hidden transition-all shadow-sm">
      <div 
        className={`flex items-center gap-3 p-3.5 ${parsedResult || status === "executing" ? "cursor-pointer hover:bg-muted/30" : ""} transition-colors`}
        onClick={() => (parsedResult || status === "executing") && setIsExpanded(!isExpanded)}
      >
        <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 border ${
          status === 'complete' ? 'bg-primary/10 border-primary/20 text-primary' : 
          status === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-500' :
          'bg-muted border-border text-muted-foreground'
        }`}>
          {status === 'executing' ? (
            <Loader2 className="h-4.5 w-4.5 animate-spin" />
          ) : (
            <Icon className="h-4.5 w-4.5" />
          )}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground truncate">
              {config.label}
            </span>
            {status === "error" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 font-medium border border-red-500/20">
                Failed
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {config.description(args)}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {(status === "complete" && parsedResult || status === "executing") && (
            <div className={`text-muted-foreground/50 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}>
              <ChevronDown className="h-4 w-4" />
            </div>
          )}
        </div>
      </div>

      {isExpanded && (parsedResult || status === "executing") && (
        <div className="px-3.5 pb-3.5 pt-0 animate-in slide-in-from-top-2 fade-in duration-200 border-t border-border/30">
          <div className="pt-3">
            {renderResultContent()}
          </div>
        </div>
      )}
    </div>
  );
}
