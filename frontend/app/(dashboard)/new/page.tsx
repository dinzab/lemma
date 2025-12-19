"use client";

import { Library, Lightbulb, Calculator, Paperclip, Mic, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export default function NewChatPage() {
  return (
    <>
      <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-6 lg:p-8 overflow-y-auto">
        <div className="flex flex-col items-center gap-6 text-center max-w-xl w-full">
          <div className="bg-primary rounded-full p-4">
            <Library className="text-primary-foreground h-12 w-12" />
          </div>
          
          <div className="flex flex-col items-center gap-2">
            <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground">
              Hello! How can I help you study today?
            </h1>
            <p className="text-base text-muted-foreground">
              You can ask me anything from explaining photosynthesis to helping you with a math problem.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-md pt-4">
            <button className="flex flex-1 gap-3 rounded-lg border border-border bg-card p-4 items-center hover:border-primary transition-colors cursor-pointer text-left">
              <Lightbulb className="text-primary h-6 w-6 shrink-0" />
              <h2 className="text-sm font-semibold text-foreground">Explain photosynthesis</h2>
            </button>
            
            <button className="flex flex-1 gap-3 rounded-lg border border-border bg-card p-4 items-center hover:border-primary transition-colors cursor-pointer text-left">
              <Calculator className="text-primary h-6 w-6 shrink-0" />
              <h2 className="text-sm font-semibold text-foreground">Help me with a math problem</h2>
            </button>
          </div>
        </div>
      </div>

      {/* Input Area */}
      <div className="p-4 md:p-6 bg-background">
        <div className="max-w-4xl mx-auto">
          <div className="relative flex items-center">
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-2 h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
            >
              <Paperclip className="h-5 w-5" />
            </Button>
            
            <Textarea
              className="min-h-[52px] w-full resize-none rounded-xl border-border bg-card py-3 pr-24 pl-12 placeholder:text-muted-foreground focus-visible:ring-primary"
              placeholder="Type your message here..."
              rows={1}
            />
            
            <div className="absolute right-2 flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
              >
                <Mic className="h-5 w-5" />
              </Button>
              
              <Button
                size="icon"
                className="h-9 w-9 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Send className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
