"use client";

import * as React from "react";
import { motion } from "motion/react";
import { Loader2, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ChipColor = "sky" | "amber" | "green" | "blue" | "red" | "purple";

export type WorkflowSubtask = {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
  color?: ChipColor;
  loading?: boolean;
};

export type WorkflowCardData = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc?: string;
  color?: "sky" | "amber" | "green" | "purple";
  badge?: string;
  time?: string;
  subtasks?: WorkflowSubtask[];
  footer?: { icon: React.ComponentType<{ className?: string }>; text: string; color?: ChipColor };
  model?: string;
  /** Custom body rendered between desc and subtasks (e.g. mini chart, timeline). */
  body?: React.ReactNode;
  /** Override the type label shown on the small tab above the card. */
  typeLabel?: string;
  /** Compact width override, in tailwind w-* class (default `w-72`). */
  width?: "sm" | "md" | "lg";
};

const headerStyles: Record<NonNullable<WorkflowCardData["color"]>, string> = {
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  green: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
  purple: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
};

const iconColorClasses: Record<ChipColor, string> = {
  sky: "text-sky-600 dark:text-sky-400",
  amber: "text-amber-600 dark:text-amber-400",
  green: "text-green-600 dark:text-green-400",
  blue: "text-blue-500",
  red: "text-rose-500",
  purple: "text-purple-600 dark:text-purple-400",
};

const iconBgClasses: Record<NonNullable<WorkflowCardData["color"]>, string> = {
  sky: "bg-sky-500/10",
  amber: "bg-amber-500/10",
  green: "bg-green-500/10",
  purple: "bg-purple-500/10",
};

const widthClasses: Record<NonNullable<WorkflowCardData["width"]>, string> = {
  sm: "w-60",
  md: "w-72",
  lg: "w-80",
};

type CardKind = "input" | "action" | "output" | "source" | "feed" | "chart";

function WorkflowCard({
  data,
  type,
  delay,
  className,
}: {
  data: WorkflowCardData;
  type: CardKind;
  delay: number;
  className?: string;
}) {
  const headerColor: NonNullable<WorkflowCardData["color"]> =
    data.color ?? (type === "input" || type === "source" || type === "feed" ? "sky" : type === "output" || type === "chart" ? "green" : "amber");
  const Icon = data.icon;
  const labelColor: NonNullable<WorkflowCardData["color"]> = headerColor;
  const widthCls = widthClasses[data.width ?? "md"];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
      className={cn("relative z-10", widthCls, className)}
    >
      {data.badge && (
        <div className="absolute -top-3 -right-3 z-20">
          <Badge variant="destructive" className="flex items-center gap-1 rounded-md px-2 py-0.5 shadow-lg">
            <AlertCircle className="size-3" />
            {data.badge}
          </Badge>
        </div>
      )}

      <div
        className={cn(
          "absolute -top-6 left-0 flex items-center gap-1.5 rounded-t-lg border-x border-t bg-card px-3 py-1 text-[10px] font-semibold capitalize",
          headerStyles[labelColor],
        )}
      >
        <Icon className="size-3" />
        {data.typeLabel ?? type}
      </div>

      <div className="relative flex flex-col gap-3 rounded-xl rounded-tl-none border bg-card p-4 text-card-foreground shadow-xl">
        <div className="flex w-full items-center gap-2.5">
          <div className={cn("rounded-lg p-2", iconBgClasses[headerColor])}>
            <Icon className={cn("size-4", iconColorClasses[headerColor])} />
          </div>
          <div className="grow text-sm font-medium">{data.title}</div>
          {data.time && (type === "input" || type === "source") && (
            <span className="text-[10px] text-muted-foreground">{data.time}</span>
          )}
        </div>

        {data.desc && <p className="text-xs leading-relaxed text-muted-foreground">{data.desc}</p>}

        {data.body}

        {data.subtasks && (
          <div className="space-y-2 rounded-lg border bg-muted/50 p-2.5">
            {type === "action" && (
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Processing
                </span>
                {data.time && <span className="text-[10px] text-muted-foreground">{data.time}</span>}
              </div>
            )}
            <div className="space-y-1.5">
              {data.subtasks.map((task, i) => {
                const TaskIcon = task.icon;
                return (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {task.loading ? (
                      <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                    ) : (
                      <TaskIcon className={cn("size-3.5", iconColorClasses[task.color ?? headerColor])} />
                    )}
                    {task.text}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {data.footer && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-2.5 text-xs">
            <data.footer.icon className={cn("size-4", iconColorClasses[data.footer.color ?? headerColor])} />
            {data.footer.text}
          </div>
        )}

        <div className="mt-1 flex items-center justify-between">
          {type === "action" ? (
            <Badge variant="outline" className="rounded-md px-2 py-0.5 text-[10px]">
              <span className="mr-1 inline-block size-1.5 rounded-full bg-primary" />
              {data.model ?? "BacPrep AI"}
            </Badge>
          ) : (
            <span className="text-[10px] text-muted-foreground">{data.time ?? ""}</span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* --------------------------- Path primitives --------------------------- */

type Pt = { x: number; y: number };
type PathShape = "step-down-right" | "step-up-right" | "step-down-left" | "step-up-left" | "horizontal";

function buildPath(start: Pt, end: Pt, shape: PathShape): { d: string; cardY: number } {
  const r = 18;
  if (shape === "horizontal") {
    return { d: `M ${start.x} ${start.y} L ${end.x} ${end.y}`, cardY: start.y };
  }
  if (shape === "step-down-right") {
    const cardY = start.y - 6;
    return {
      d: `M ${start.x} ${cardY} L ${start.x} ${end.y - r} Q ${start.x} ${end.y} ${start.x + r} ${end.y} L ${end.x} ${end.y}`,
      cardY,
    };
  }
  if (shape === "step-up-right") {
    const cardY = start.y + 6;
    return {
      d: `M ${start.x} ${cardY} L ${start.x} ${end.y + r} Q ${start.x} ${end.y} ${start.x + r} ${end.y} L ${end.x} ${end.y}`,
      cardY,
    };
  }
  if (shape === "step-down-left") {
    const cardY = start.y - 6;
    return {
      d: `M ${start.x} ${cardY} L ${start.x} ${end.y - r} Q ${start.x} ${end.y} ${start.x - r} ${end.y} L ${end.x} ${end.y}`,
      cardY,
    };
  }
  // step-up-left
  const cardY = start.y + 6;
  return {
    d: `M ${start.x} ${cardY} L ${start.x} ${end.y + r} Q ${start.x} ${end.y} ${start.x - r} ${end.y} L ${end.x} ${end.y}`,
    cardY,
  };
}

function WorkflowPath({
  start,
  end,
  shape,
  delay,
  showStartMarker = true,
}: {
  start: Pt;
  end: Pt;
  shape: PathShape;
  delay: number;
  showStartMarker?: boolean;
}) {
  const { d } = buildPath(start, end, shape);
  const flowDir = shape === "step-down-left" || shape === "step-up-left" ? -1 : 1;
  return (
    <g className="text-primary/40">
      <motion.path
        d={d}
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="4 4"
        strokeLinecap="round"
        fill="none"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1, delay: delay + 0.3, ease: "easeInOut" }}
      />
      {showStartMarker && (
        <motion.path
          d={`M ${start.x - 6} ${start.y} L ${start.x} ${start.y - 6} L ${start.x + 6} ${start.y} L ${start.x} ${start.y + 6} Z`}
          fill="currentColor"
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay }}
        />
      )}
      <motion.path
        d={`M ${end.x - 8 * flowDir} ${end.y - 6} L ${end.x} ${end.y} L ${end.x - 8 * flowDir} ${end.y + 6}`}
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ opacity: 0, x: -5 * flowDir }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, delay: delay + 1.1 }}
      />
      <motion.circle
        r="3"
        className="fill-primary"
        initial={{ opacity: 0 }}
        animate={{ offsetDistance: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
        style={{ offsetPath: `path("${d}")` }}
        transition={{
          duration: 2,
          delay: delay + 1.4,
          ease: "linear",
          repeat: Infinity,
          repeatDelay: 2,
        }}
      />
    </g>
  );
}

/* --------------------------- Layout helpers --------------------------- */

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

function rectIn(c: DOMRect, el: HTMLElement | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    left: r.left - c.left,
    top: r.top - c.top,
    right: r.right - c.left,
    bottom: r.bottom - c.top,
    width: r.width,
    height: r.height,
  };
}

function rectsEqual(a: Rect, b: Rect): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

/**
 * Subscribes a layout to its container size and emits a stable `tick`
 * counter whenever a re-measure may be needed. Each layout reads its own
 * refs in a `useEffect` keyed on this tick.
 */
function useLayoutTick(containerRef: React.RefObject<HTMLDivElement | null>): number {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    bump();
    const t = setTimeout(bump, 100);
    const obs = new ResizeObserver(bump);
    if (containerRef.current) obs.observe(containerRef.current);
    window.addEventListener("resize", bump);
    return () => {
      clearTimeout(t);
      obs.disconnect();
      window.removeEventListener("resize", bump);
    };
  }, [containerRef]);
  return tick;
}

/* --------------------------- Layouts --------------------------- */

type ThreeCornerSpec = {
  kind: "three-corner";
  input: WorkflowCardData;
  action: WorkflowCardData;
  output: WorkflowCardData;
};

function ThreeCornerLayout({ spec }: { spec: ThreeCornerSpec }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLDivElement>(null);
  const actionRef = React.useRef<HTMLDivElement>(null);
  const outputRef = React.useRef<HTMLDivElement>(null);
  const tick = useLayoutTick(containerRef);
  const [rects, setRects] = React.useState<{ input: Rect; action: Rect; output: Rect } | null>(null);

  React.useEffect(() => {
    const c = containerRef.current?.getBoundingClientRect();
    if (!c) return;
    const i = rectIn(c, inputRef.current);
    const a = rectIn(c, actionRef.current);
    const o = rectIn(c, outputRef.current);
    if (!i || !a || !o) return;
    setRects((prev) => (prev && rectsEqual(prev.input, i) && rectsEqual(prev.action, a) && rectsEqual(prev.output, o) ? prev : { input: i, action: a, output: o }));
  }, [tick]);

  return (
    <div ref={containerRef} className="relative flex h-full min-h-[420px] w-full items-center justify-center md:min-h-[550px]">
      <div className="flex w-full max-w-sm flex-col items-center gap-10 md:hidden">
        <WorkflowCard data={spec.input} type="input" delay={0} />
        <WorkflowCard data={spec.action} type="action" delay={0.3} />
        <WorkflowCard data={spec.output} type="output" delay={0.6} />
      </div>

      <div className="relative hidden h-full w-full max-w-5xl md:block">
        <div ref={inputRef} className="absolute top-[10%] left-[5%] z-10">
          <WorkflowCard data={spec.input} type="input" delay={0} />
        </div>
        <div ref={actionRef} className="absolute bottom-[10%] left-[35%] z-10">
          <WorkflowCard data={spec.action} type="action" delay={1.5} />
        </div>
        <div ref={outputRef} className="absolute top-[5%] right-[5%] z-10">
          <WorkflowCard data={spec.output} type="output" delay={3} />
        </div>

        {rects && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            <WorkflowPath
              start={{ x: rects.input.left + rects.input.width / 2, y: rects.input.bottom }}
              end={{ x: rects.action.left, y: rects.action.top + rects.action.height / 2 }}
              shape="step-down-right"
              delay={0.5}
            />
            <WorkflowPath
              start={{ x: rects.action.left + rects.action.width / 2, y: rects.action.top }}
              end={{ x: rects.output.left, y: rects.output.top + rects.output.height / 2 }}
              shape="step-up-right"
              delay={2}
            />
          </svg>
        )}
      </div>
    </div>
  );
}

type SplitActionSpec = {
  kind: "split-action";
  input: WorkflowCardData;
  actions: [WorkflowCardData, WorkflowCardData];
  output: WorkflowCardData;
};

function SplitActionLayout({ spec }: { spec: SplitActionSpec }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLDivElement>(null);
  const leftRef = React.useRef<HTMLDivElement>(null);
  const rightRef = React.useRef<HTMLDivElement>(null);
  const outputRef = React.useRef<HTMLDivElement>(null);
  const tick = useLayoutTick(containerRef);
  const [rects, setRects] = React.useState<{ input: Rect; left: Rect; right: Rect; output: Rect } | null>(null);

  React.useEffect(() => {
    const c = containerRef.current?.getBoundingClientRect();
    if (!c) return;
    const i = rectIn(c, inputRef.current);
    const l = rectIn(c, leftRef.current);
    const r = rectIn(c, rightRef.current);
    const o = rectIn(c, outputRef.current);
    if (!i || !l || !r || !o) return;
    setRects((prev) =>
      prev && rectsEqual(prev.input, i) && rectsEqual(prev.left, l) && rectsEqual(prev.right, r) && rectsEqual(prev.output, o)
        ? prev
        : { input: i, left: l, right: r, output: o },
    );
  }, [tick]);

  return (
    <div ref={containerRef} className="relative flex h-full min-h-[420px] w-full items-center justify-center md:min-h-[600px]">
      <div className="flex w-full max-w-sm flex-col items-center gap-10 md:hidden">
        <WorkflowCard data={spec.input} type="input" delay={0} />
        <WorkflowCard data={{ ...spec.actions[0], width: "md" }} type="action" delay={0.3} />
        <WorkflowCard data={{ ...spec.actions[1], width: "md" }} type="action" delay={0.6} />
        <WorkflowCard data={spec.output} type="output" delay={0.9} />
      </div>

      <div className="relative hidden h-full w-full max-w-5xl md:block">
        <div ref={inputRef} className="absolute top-[5%] left-1/2 z-10 -translate-x-1/2">
          <WorkflowCard data={spec.input} type="input" delay={0} />
        </div>
        <div ref={leftRef} className="absolute top-[42%] left-[3%] z-10">
          <WorkflowCard data={{ ...spec.actions[0], width: "sm" }} type="action" delay={1.4} />
        </div>
        <div ref={rightRef} className="absolute top-[42%] right-[3%] z-10">
          <WorkflowCard data={{ ...spec.actions[1], width: "sm" }} type="action" delay={1.4} />
        </div>
        <div ref={outputRef} className="absolute bottom-[3%] left-1/2 z-10 -translate-x-1/2">
          <WorkflowCard data={spec.output} type="output" delay={3} />
        </div>

        {rects && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            {/* Input -> left action */}
            <WorkflowPath
              start={{ x: rects.input.left + rects.input.width / 2, y: rects.input.bottom }}
              end={{ x: rects.left.right, y: rects.left.top + rects.left.height / 2 }}
              shape="step-down-left"
              delay={0.5}
            />
            {/* Input -> right action */}
            <WorkflowPath
              start={{ x: rects.input.left + rects.input.width / 2, y: rects.input.bottom }}
              end={{ x: rects.right.left, y: rects.right.top + rects.right.height / 2 }}
              shape="step-down-right"
              delay={0.5}
              showStartMarker={false}
            />
            {/* Left action -> output */}
            <WorkflowPath
              start={{ x: rects.left.left + rects.left.width / 2, y: rects.left.bottom }}
              end={{ x: rects.output.left, y: rects.output.top + rects.output.height / 2 }}
              shape="step-down-right"
              delay={1.9}
            />
            {/* Right action -> output */}
            <WorkflowPath
              start={{ x: rects.right.left + rects.right.width / 2, y: rects.right.bottom }}
              end={{ x: rects.output.right, y: rects.output.top + rects.output.height / 2 }}
              shape="step-down-left"
              delay={1.9}
            />
          </svg>
        )}
      </div>
    </div>
  );
}

type FanInSpec = {
  kind: "fan-in";
  inputs: WorkflowCardData[];
  output: WorkflowCardData;
};

function FanInLayout({ spec }: { spec: FanInSpec }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const outputRef = React.useRef<HTMLDivElement>(null);
  const inputRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const [paths, setPaths] = React.useState<{ start: Pt; end: Pt }[]>([]);
  const tick = useLayoutTick(containerRef);
  const inputCount = spec.inputs.length;

  React.useEffect(() => {
    const c = containerRef.current?.getBoundingClientRect();
    const o = outputRef.current?.getBoundingClientRect();
    if (!c || !o) return;
    const next: { start: Pt; end: Pt }[] = [];
    for (let idx = 0; idx < inputCount; idx++) {
      const i = inputRefs.current[idx]?.getBoundingClientRect();
      if (!i) return;
      next.push({
        start: { x: i.right - c.left, y: i.top - c.top + i.height / 2 },
        end: { x: o.left - c.left, y: o.top - c.top + o.height / 2 },
      });
    }
    setPaths((prev) => {
      if (prev.length !== next.length) return next;
      for (let k = 0; k < prev.length; k++) {
        if (
          prev[k].start.x !== next[k].start.x ||
          prev[k].start.y !== next[k].start.y ||
          prev[k].end.x !== next[k].end.x ||
          prev[k].end.y !== next[k].end.y
        ) {
          return next;
        }
      }
      return prev;
    });
  }, [tick, inputCount]);

  return (
    <div ref={containerRef} className="relative flex h-full min-h-[420px] w-full items-center justify-center md:min-h-[600px]">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 md:hidden">
        {spec.inputs.map((src, i) => (
          <WorkflowCard key={i} data={{ ...src, width: "md" }} type="source" delay={i * 0.2} />
        ))}
        <WorkflowCard data={spec.output} type="output" delay={spec.inputs.length * 0.2 + 0.3} />
      </div>

      <div className="relative hidden h-full w-full max-w-5xl md:block">
        <div className="absolute top-1/2 left-[5%] z-10 flex -translate-y-1/2 flex-col gap-6">
          {spec.inputs.map((src, i) => (
            <div
              key={i}
              ref={(el) => {
                inputRefs.current[i] = el;
              }}
            >
              <WorkflowCard data={{ ...src, width: "sm" }} type="source" delay={i * 0.25} />
            </div>
          ))}
        </div>
        <div ref={outputRef} className="absolute top-1/2 right-[5%] z-10 -translate-y-1/2">
          <WorkflowCard data={spec.output} type="output" delay={spec.inputs.length * 0.25 + 1.2} />
        </div>

        {paths.length > 0 && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            {paths.map((coords, i) => (
              <WorkflowPath
                key={i}
                start={coords.start}
                end={coords.end}
                shape="horizontal"
                delay={i * 0.25 + 0.5}
              />
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}

type LinearSpec = {
  kind: "linear";
  input: WorkflowCardData;
  output: WorkflowCardData;
};

function LinearLayout({ spec }: { spec: LinearSpec }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLDivElement>(null);
  const outputRef = React.useRef<HTMLDivElement>(null);
  const tick = useLayoutTick(containerRef);
  const [rects, setRects] = React.useState<{ input: Rect; output: Rect } | null>(null);

  React.useEffect(() => {
    const c = containerRef.current?.getBoundingClientRect();
    if (!c) return;
    const i = rectIn(c, inputRef.current);
    const o = rectIn(c, outputRef.current);
    if (!i || !o) return;
    setRects((prev) => (prev && rectsEqual(prev.input, i) && rectsEqual(prev.output, o) ? prev : { input: i, output: o }));
  }, [tick]);

  return (
    <div ref={containerRef} className="relative flex h-full min-h-[420px] w-full items-center justify-center md:min-h-[550px]">
      <div className="flex w-full max-w-sm flex-col items-center gap-10 md:hidden">
        <WorkflowCard data={spec.input} type="input" delay={0} />
        <WorkflowCard data={spec.output} type="output" delay={0.5} />
      </div>

      <div className="relative hidden h-full w-full max-w-5xl items-center justify-between gap-12 md:flex">
        <div ref={inputRef} className="z-10 ml-[5%]">
          <WorkflowCard data={{ ...spec.input, width: "lg" }} type="input" delay={0} />
        </div>
        <div ref={outputRef} className="z-10 mr-[5%]">
          <WorkflowCard data={{ ...spec.output, width: "lg" }} type="output" delay={1.6} />
        </div>

        {rects && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            <WorkflowPath
              start={{ x: rects.input.right, y: rects.input.top + rects.input.height / 2 }}
              end={{ x: rects.output.left, y: rects.output.top + rects.output.height / 2 }}
              shape="horizontal"
              delay={0.5}
            />
          </svg>
        )}
      </div>
    </div>
  );
}

/* --------------------------- Public API --------------------------- */

export type WorkflowSpec = ThreeCornerSpec | SplitActionSpec | FanInSpec | LinearSpec;

export function WorkflowAnimation({ spec }: { spec: WorkflowSpec }) {
  switch (spec.kind) {
    case "three-corner":
      return <ThreeCornerLayout spec={spec} />;
    case "split-action":
      return <SplitActionLayout spec={spec} />;
    case "fan-in":
      return <FanInLayout spec={spec} />;
    case "linear":
      return <LinearLayout spec={spec} />;
  }
}
