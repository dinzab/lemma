"use client";

import { Button } from "@/components/ui/button";
import {
  ButtonGroup,
  ButtonGroupText,
} from "@/components/ui/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { UIMessage } from "ai";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactElement } from "react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Streamdown, defaultUrlTransform } from "streamdown";
import type { UrlTransform } from "streamdown";
import {
  LemmaInlineCitation,
  LemmaInlineCitationFigure,
} from "@/components/chat/LemmaInlineCitation";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full flex-col gap-2",
      from === "user"
        ? "is-user max-w-[85%] sm:max-w-[78%] ml-auto items-end justify-end"
        : "is-assistant max-w-full",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-[15px] leading-relaxed",
      "group-[.is-user]:rounded-2xl group-[.is-user]:bg-primary group-[.is-user]:px-4 group-[.is-user]:py-2.5 group-[.is-user]:text-primary-foreground group-[.is-user]:shadow-sm",
      "group-[.is-assistant]:w-full group-[.is-assistant]:text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({
  className,
  children,
  ...props
}: MessageActionsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props}>
    {children}
  </div>
);

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
};

export const MessageAction = ({
  tooltip,
  children,
  label,
  variant = "ghost",
  size = "icon-sm",
  ...props
}: MessageActionProps) => {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  );

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return button;
};

interface MessageBranchContextType {
  currentBranch: number;
  totalBranches: number;
  goToPrevious: () => void;
  goToNext: () => void;
  branches: ReactElement[];
  setBranches: (branches: ReactElement[]) => void;
}

const MessageBranchContext = createContext<MessageBranchContextType | null>(
  null
);

const useMessageBranch = () => {
  const context = useContext(MessageBranchContext);

  if (!context) {
    throw new Error(
      "MessageBranch components must be used within MessageBranch"
    );
  }

  return context;
};

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
  defaultBranch?: number;
  onBranchChange?: (branchIndex: number) => void;
};

export const MessageBranch = ({
  defaultBranch = 0,
  onBranchChange,
  className,
  ...props
}: MessageBranchProps) => {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch);
  const [branches, setBranches] = useState<ReactElement[]>([]);

  const handleBranchChange = useCallback(
    (newBranch: number) => {
      setCurrentBranch(newBranch);
      onBranchChange?.(newBranch);
    },
    [onBranchChange]
  );

  const goToPrevious = useCallback(() => {
    const newBranch =
      currentBranch > 0 ? currentBranch - 1 : branches.length - 1;
    handleBranchChange(newBranch);
  }, [currentBranch, branches.length, handleBranchChange]);

  const goToNext = useCallback(() => {
    const newBranch =
      currentBranch < branches.length - 1 ? currentBranch + 1 : 0;
    handleBranchChange(newBranch);
  }, [currentBranch, branches.length, handleBranchChange]);

  const contextValue = useMemo<MessageBranchContextType>(
    () => ({
      branches,
      currentBranch,
      goToNext,
      goToPrevious,
      setBranches,
      totalBranches: branches.length,
    }),
    [branches, currentBranch, goToNext, goToPrevious]
  );

  return (
    <MessageBranchContext.Provider value={contextValue}>
      <div
        className={cn("grid w-full gap-2 [&>div]:pb-0", className)}
        {...props}
      />
    </MessageBranchContext.Provider>
  );
};

export type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageBranchContent = ({
  children,
  ...props
}: MessageBranchContentProps) => {
  const { currentBranch, setBranches, branches } = useMessageBranch();
  const childrenArray = useMemo(
    () => (Array.isArray(children) ? children : [children]),
    [children]
  );

  // Use useEffect to update branches when they change
  useEffect(() => {
    if (branches.length !== childrenArray.length) {
      setBranches(childrenArray);
    }
  }, [childrenArray, branches, setBranches]);

  return childrenArray.map((branch, index) => (
    <div
      className={cn(
        "grid gap-2 overflow-hidden [&>div]:pb-0",
        index === currentBranch ? "block" : "hidden"
      )}
      key={branch.key}
      {...props}
    >
      {branch}
    </div>
  ));
};

export type MessageBranchSelectorProps = ComponentProps<typeof ButtonGroup>;

export const MessageBranchSelector = ({
  className,
  ...props
}: MessageBranchSelectorProps) => {
  const { totalBranches } = useMessageBranch();

  // Don't render if there's only one branch
  if (totalBranches <= 1) {
    return null;
  }

  return (
    <ButtonGroup
      className={cn(
        "[&>*:not(:first-child)]:rounded-l-md [&>*:not(:last-child)]:rounded-r-md",
        className
      )}
      orientation="horizontal"
      {...props}
    />
  );
};

export type MessageBranchPreviousProps = ComponentProps<typeof Button>;

export const MessageBranchPrevious = ({
  children,
  ...props
}: MessageBranchPreviousProps) => {
  const { goToPrevious, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Previous branch"
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronLeftIcon size={14} />}
    </Button>
  );
};

export type MessageBranchNextProps = ComponentProps<typeof Button>;

export const MessageBranchNext = ({
  children,
  ...props
}: MessageBranchNextProps) => {
  const { goToNext, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Next branch"
      disabled={totalBranches <= 1}
      onClick={goToNext}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronRightIcon size={14} />}
    </Button>
  );
};

export type MessageBranchPageProps = HTMLAttributes<HTMLSpanElement>;

export const MessageBranchPage = ({
  className,
  ...props
}: MessageBranchPageProps) => {
  const { currentBranch, totalBranches } = useMessageBranch();

  return (
    <ButtonGroupText
      className={cn(
        "border-none bg-transparent text-muted-foreground shadow-none",
        className
      )}
      {...props}
    >
      {currentBranch + 1} of {totalBranches}
    </ButtonGroupText>
  );
};

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

// Configure the math plugin to recognise single `$...$` for inline math
// in addition to the default `$$...$$` for display math. The default
// `singleDollarTextMath: false` is too strict for typical LLM output —
// most models emit a mix of `$x = 1$` and `$$\int f(x)dx$$`.
const streamdownPlugins = {
  cjk,
  code,
  math: createMathPlugin({ singleDollarTextMath: true }),
  mermaid,
};

/**
 * Streamdown's default `urlTransform` (inherited from react-markdown)
 * strips any `href` whose protocol isn't on a small allow-list
 * (http, https, mailto, tel, irc, sms, …). Our agent emits
 * `lemma:` URIs for inline citation chips (`lemma:pair:…`,
 * `lemma:fig:…`, `lemma:exercise:…`, `lemma:exam:…`); we
 * pass them through verbatim and dispatch them to a custom
 * `<a>` renderer below. Everything else falls back to the default
 * sanitiser — we never want to weaken protocol checks for the
 * generic case.
 */
const lemmaSafeUrlTransform: UrlTransform = (url, key, node) => {
  if (typeof url === "string" && url.startsWith("lemma:")) return url;
  return defaultUrlTransform(url, key, node);
};

interface AnchorComponentProps extends ComponentProps<"a"> {
  // Streamdown's `Components` map adds an `ExtraProps` member with
  // the original hast `node` — we don't currently need it.
  node?: unknown;
}

function LemmaAwareAnchor({
  href,
  children,
  className,
  node: _node,
  ...rest
}: AnchorComponentProps) {
  void _node;
  if (typeof href === "string" && href.startsWith("lemma:fig:")) {
    return (
      <LemmaInlineCitationFigure refUri={href} className={className}>
        {children}
      </LemmaInlineCitationFigure>
    );
  }
  if (
    typeof href === "string" &&
    (href.startsWith("lemma:pair:") ||
      href.startsWith("lemma:exercise:") ||
      href.startsWith("lemma:exam:"))
  ) {
    return (
      <LemmaInlineCitation refUri={href} className={className}>
        {children}
      </LemmaInlineCitation>
    );
  }
  return (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  );
}

const streamdownComponents = {
  a: LemmaAwareAnchor,
};

/**
 * Convert LaTeX-native math delimiters to the `$...$` / `$$...$$`
 * delimiters that `remark-math` understands.
 *
 * LLMs aimed at chat surfaces frequently emit `\(...\)` for inline math
 * and `\[...\]` for display math (the official LaTeX syntax). Markdown
 * happens to interpret `\(` and `\[` as escapes, so the visible result
 * is `( ... )` / `[ ... ]` with the inner LaTeX unparsed — which is
 * exactly what was leaking through to the chat surface.
 *
 * We rewrite those forms to dollar-delimited math BEFORE handing the
 * text to Streamdown so `remark-math` picks them up. The regexes are
 * deliberately conservative: they require the closing delimiter on the
 * same logical block and use `[\s\S]` to allow newlines in display
 * math while not crossing back into other markdown contexts.
 */
function normaliseMathDelimiters(input: string): string {
  return (
    input
      // \[ ... \]  →  $$ ... $$
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, body: string) => `$$${body}$$`)
      // \( ... \)  →  $ ... $
      .replace(/\\\(([\s\S]+?)\\\)/g, (_, body: string) => `$${body}$`)
  );
}

export const MessageResponse = memo(
  ({ className, children, ...props }: MessageResponseProps) => {
    const normalised =
      typeof children === "string" ? normaliseMathDelimiters(children) : children;
    return (
      <Streamdown
        className={cn(
          "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          className
        )}
        plugins={streamdownPlugins}
        components={streamdownComponents}
        urlTransform={lemmaSafeUrlTransform}
        {...props}
      >
        {normalised}
      </Streamdown>
    );
  },
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating
);

MessageResponse.displayName = "MessageResponse";

export type MessageToolbarProps = ComponentProps<"div">;

export const MessageToolbar = ({
  className,
  children,
  ...props
}: MessageToolbarProps) => (
  <div
    className={cn(
      "mt-4 flex w-full items-center justify-between gap-4",
      className
    )}
    {...props}
  >
    {children}
  </div>
);
