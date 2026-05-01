"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronRight, BrainCircuit, Loader2 } from "lucide-react";

interface ThinkingRendererProps {
  content: string;
  isComplete?: boolean;
  isLoading?: boolean;
}

export function ThinkingRenderer({ content, isComplete = true, isLoading = false }: ThinkingRendererProps) {
  const [isManuallyClosed, setIsManuallyClosed] = useState(isComplete);
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  const isOpen = !isManuallyClosed;

  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  useEffect(() => {
    if (isComplete || !isLoading) return;

    const start = Date.now() - elapsedRef.current * 1000;
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isComplete, isLoading]);

  if (!content && isComplete) return null;

  return (
    <div className="mb-4 rounded-lg border border-border/40 bg-muted/20 overflow-hidden">
      <button
        onClick={() => setIsManuallyClosed(isOpen)}
        className="flex items-center gap-2 w-full p-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-all duration-200"
      >
        <div className={`transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}>
          <ChevronRight className="h-3.5 w-3.5" />
        </div>
        <BrainCircuit className="h-3.5 w-3.5 text-primary/70" />
        <span>Thinking Process</span>
        
        {!isComplete && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-[10px] opacity-70 font-mono">{elapsed}s</span>
            {isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin text-primary/70" />
            ) : (
              <div className="h-1.5 w-1.5 rounded-full bg-red-500/50" />
            )}
          </div>
        )}
      </button>
      
      {isOpen && (
        <div className="p-3 pt-0 text-xs text-muted-foreground border-t border-border/30 bg-background/30 animate-in slide-in-from-top-2 fade-in duration-200">
          <div className="prose prose-xs dark:prose-invert max-w-none text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {content || <span className="animate-pulse">Analyzing request...</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Helper to parse message content and separate thinking blocks
 */
export function parseThinkingContent(text: string): { thinking: string; content: string; isComplete: boolean } {
  // Check for complete tag first
  const completeMatch = text.match(/<think>([\s\S]*?)<\/think>/i);
  if (completeMatch) {
    return {
      thinking: completeMatch[1].trim(),
      content: text.replace(/<think>[\s\S]*?<\/think>/i, "").trim(),
      isComplete: true
    };
  }

  // Check for open tag (streaming)
  const openMatch = text.match(/<think>([\s\S]*)/i);
  if (openMatch) {
    return {
      thinking: openMatch[1].trim(),
      content: "", // While thinking, main content is usually empty or comes after
      isComplete: false
    };
  }
  
  return { thinking: "", content: text, isComplete: true };
}
