"use client";

import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
// import 'highlight.js/styles/github-dark.css'; // Uncomment if highlight.js is installed and you want code highlighting

// Define plugins outside the component to ensure stable identity and prevent re-renders
const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [rehypeKatex, rehypeHighlight];

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

const MarkdownRendererComponent = ({ content, className }: MarkdownRendererProps) => {
  if (!content) return null;
  
  // Memoize components object to prevent unnecessary re-renders
  const components = useMemo(() => ({
    // Custom renderer for code blocks to add styling or copy button if needed later
    code: ({ node, inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '');
      return !inline && match ? (
        <pre className="rounded-md bg-muted/50 p-4 overflow-x-auto my-4 border border-border/50">
          <code className={className} {...props}>
            {children}
          </code>
        </pre>
      ) : (
        <code className="bg-muted/50 px-1.5 py-0.5 rounded text-sm font-mono text-primary" {...props}>
          {children}
        </code>
      );
    },
    // Style tables
    table: ({ children }: any) => (
      <div className="overflow-x-auto my-4 rounded-lg border border-border/50">
        <table className="w-full text-sm text-left">{children}</table>
      </div>
    ),
    thead: ({ children }: any) => (
      <thead className="bg-muted/50 text-xs uppercase text-muted-foreground font-medium">
        {children}
      </thead>
    ),
    th: ({ children }: any) => (
      <th className="px-4 py-3 border-b border-border/50 whitespace-nowrap">
        {children}
      </th>
    ),
    td: ({ children }: any) => (
      <td className="px-4 py-3 border-b border-border/50">
        {children}
      </td>
    ),
    // Style links
    a: ({ children, href }: any) => (
      <a 
        href={href} 
        target="_blank" 
        rel="noopener noreferrer" 
        className="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
      >
        {children}
      </a>
    ),
    // Style blockquotes
    blockquote: ({ children }: any) => (
      <blockquote className="border-l-4 border-primary/30 pl-4 italic my-4 text-muted-foreground">
        {children}
      </blockquote>
    ),
    // Style lists
    ul: ({ children }: any) => (
      <ul className="list-disc list-outside ml-5 my-2 space-y-1 marker:text-muted-foreground">
        {children}
      </ul>
    ),
    ol: ({ children }: any) => (
      <ol className="list-decimal list-outside ml-5 my-2 space-y-1 marker:text-muted-foreground">
        {children}
      </ol>
    ),
    // Headings
    h1: ({ children }: any) => <h1 className="text-2xl font-bold mt-6 mb-4 text-foreground">{children}</h1>,
    h2: ({ children }: any) => <h2 className="text-xl font-semibold mt-5 mb-3 text-foreground">{children}</h2>,
    h3: ({ children }: any) => <h3 className="text-lg font-medium mt-4 mb-2 text-foreground">{children}</h3>,
    // Paragraphs
    p: ({ children }: any) => <p className="leading-7 [&:not(:first-child)]:mt-4 text-foreground/90">{children}</p>,
  }), []);

  return (
    <div className={`markdown-content ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

// Memoize the entire component to prevent re-renders if props haven't changed
export const MarkdownRenderer = React.memo(MarkdownRendererComponent);
