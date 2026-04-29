"use client";

import * as React from "react";
import { motion } from "motion/react";
import { Loader2, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ChipColor = "sky" | "amber" | "green" | "blue" | "red";

export type WorkflowSubtask = {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
  color?: ChipColor;
  loading?: boolean;
};

export type WorkflowCardData = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  color?: "sky" | "amber" | "green";
  badge?: string;
  time?: string;
  subtasks?: WorkflowSubtask[];
  footer?: { icon: React.ComponentType<{ className?: string }>; text: string; color?: ChipColor };
  model?: string;
};

const headerStyles: Record<NonNullable<WorkflowCardData["color"]>, string> = {
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  green: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
};

const iconColorClasses: Record<ChipColor, string> = {
  sky: "text-sky-600 dark:text-sky-400",
  amber: "text-amber-600 dark:text-amber-400",
  green: "text-green-600 dark:text-green-400",
  blue: "text-blue-500",
  red: "text-rose-500",
};

const iconBgClasses: Record<NonNullable<WorkflowCardData["color"]>, string> = {
  sky: "bg-sky-500/10",
  amber: "bg-amber-500/10",
  green: "bg-green-500/10",
};

type CardKind = "input" | "action" | "output";

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
  const color = data.color ?? (type === "input" ? "sky" : type === "action" ? "amber" : "green");
  const Icon = data.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
      className={cn("relative z-10 w-72", className)}
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
          headerStyles[color],
        )}
      >
        <Icon className="size-3" />
        {type}
      </div>

      <div className="relative flex flex-col gap-3 rounded-xl rounded-tl-none border bg-card p-4 text-card-foreground shadow-xl">
        <div className="flex w-full items-center gap-2.5">
          <div className={cn("rounded-lg p-2", iconBgClasses[color])}>
            <Icon className={cn("size-4", iconColorClasses[color])} />
          </div>
          <div className="grow text-sm font-medium">{data.title}</div>
          {data.time && type === "input" && (
            <span className="text-[10px] text-muted-foreground">{data.time}</span>
          )}
        </div>

        {data.desc && (
          <p className="text-xs leading-relaxed text-muted-foreground">{data.desc}</p>
        )}

        {data.subtasks && (
          <div className="space-y-2 rounded-lg border bg-muted/50 p-2.5">
            {type === "action" && (
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Processing
                </span>
                {data.time && (
                  <span className="text-[10px] text-muted-foreground">{data.time}</span>
                )}
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
                      <TaskIcon className={cn("size-3.5", iconColorClasses[task.color ?? color])} />
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
            <data.footer.icon
              className={cn("size-4", iconColorClasses[data.footer.color ?? color])}
            />
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

type PathShape = "step-down-right" | "step-up-right";

function WorkflowPath({
  start,
  end,
  shape,
  delay,
}: {
  start: { x: number; y: number };
  end: { x: number; y: number };
  shape: PathShape;
  delay: number;
}) {
  const r = 20;
  const cardY = shape === "step-down-right" ? start.y - 6 : start.y + 6;
  const d =
    shape === "step-down-right"
      ? `M ${start.x} ${cardY} L ${start.x} ${end.y - r} Q ${start.x} ${end.y} ${start.x + r} ${end.y} L ${end.x} ${end.y}`
      : `M ${start.x} ${cardY} L ${start.x} ${end.y + r} Q ${start.x} ${end.y} ${start.x + r} ${end.y} L ${end.x} ${end.y}`;

  return (
    <g className="text-primary/40">
      {/* Dashed line that draws from start to end */}
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
      {/* Diamond marker at the start of the path */}
      <motion.path
        d={`M ${start.x - 6} ${start.y} L ${start.x} ${start.y - 6} L ${start.x + 6} ${start.y} L ${start.x} ${start.y + 6} Z`}
        fill="currentColor"
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, delay }}
      />
      {/* Chevron arrow at the end, appears once the line has finished drawing */}
      <motion.path
        d={`M ${end.x - 8} ${end.y - 6} L ${end.x} ${end.y} L ${end.x - 8} ${end.y + 6}`}
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ opacity: 0, x: -5 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, delay: delay + 1.1 }}
      />
      {/* Slow-moving dot to show data flow once the line is drawn */}
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

export type WorkflowSpec = {
  input: WorkflowCardData;
  actions: WorkflowCardData[];
  output: WorkflowCardData;
};

type Coord = { x: number; y: number };

export function WorkflowAnimation({ spec }: { spec: WorkflowSpec }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLDivElement>(null);
  const actionRef = React.useRef<HTMLDivElement>(null);
  const outputRef = React.useRef<HTMLDivElement>(null);

  const [coords, setCoords] = React.useState<{
    path1: { start: Coord; end: Coord };
    path2: { start: Coord; end: Coord };
  }>({
    path1: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } },
    path2: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } },
  });

  const updateCoords = React.useCallback(() => {
    if (!containerRef.current || !inputRef.current || !actionRef.current || !outputRef.current) return;
    const c = containerRef.current.getBoundingClientRect();
    const i = inputRef.current.getBoundingClientRect();
    const a = actionRef.current.getBoundingClientRect();
    const o = outputRef.current.getBoundingClientRect();
    setCoords({
      // Input bottom-center -> Action left-middle (step-down-right)
      path1: {
        start: { x: i.left - c.left + i.width / 2, y: i.bottom - c.top },
        end: { x: a.left - c.left, y: a.top - c.top + a.height / 2 },
      },
      // Action top-center -> Output left-middle (step-up-right)
      path2: {
        start: { x: a.left - c.left + a.width / 2, y: a.top - c.top },
        end: { x: o.left - c.left, y: o.top - c.top + o.height / 2 },
      },
    });
  }, []);

  React.useEffect(() => {
    updateCoords();
    const t = setTimeout(updateCoords, 100);
    const obs = new ResizeObserver(updateCoords);
    if (containerRef.current) obs.observe(containerRef.current);
    window.addEventListener("resize", updateCoords);
    return () => {
      clearTimeout(t);
      obs.disconnect();
      window.removeEventListener("resize", updateCoords);
    };
  }, [updateCoords]);

  return (
    <div
      ref={containerRef}
      className="relative flex h-full min-h-[420px] w-full items-center justify-center md:min-h-[550px]"
    >
      {/* Mobile fallback: stack cards vertically */}
      <div className="flex w-full max-w-sm flex-col items-center gap-10 md:hidden">
        <WorkflowCard data={spec.input} type="input" delay={0} />
        <WorkflowCard data={spec.actions[0]} type="action" delay={0.3} />
        <WorkflowCard data={spec.output} type="output" delay={0.6} />
      </div>

      {/* Desktop layout: input top-left, action bottom-center, output top-right */}
      <div className="relative hidden h-full w-full max-w-5xl md:block">
        <div ref={inputRef} className="absolute top-[10%] left-[5%] z-10">
          <WorkflowCard data={spec.input} type="input" delay={0} />
        </div>
        <div ref={actionRef} className="absolute bottom-[10%] left-[35%] z-10">
          <WorkflowCard data={spec.actions[0]} type="action" delay={1.5} />
        </div>
        <div ref={outputRef} className="absolute top-[5%] right-[5%] z-10">
          <WorkflowCard data={spec.output} type="output" delay={3} />
        </div>

        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          <WorkflowPath start={coords.path1.start} end={coords.path1.end} shape="step-down-right" delay={0.5} />
          <WorkflowPath start={coords.path2.start} end={coords.path2.end} shape="step-up-right" delay={2} />
        </svg>
      </div>
    </div>
  );
}
