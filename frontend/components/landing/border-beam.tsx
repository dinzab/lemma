import * as React from "react";
import { cn } from "@/lib/utils";

export function BorderBeam({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 rounded-[inherit] border border-transparent [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)] [mask-composite:intersect] [mask-clip:padding-box,border-box]",
        className,
      )}
    >
      <div
        className="absolute aspect-square animate-[border-beam_5s_linear_infinite] rounded-full bg-gradient-to-l from-primary via-primary to-transparent"
        style={{
          width: "35px",
          offsetPath: "rect(0px auto auto 0px round 35px)",
        }}
      />
    </div>
  );
}
