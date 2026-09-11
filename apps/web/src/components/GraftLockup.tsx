// FILE: GraftLockup.tsx
// Purpose: Render the Graft wordmark (symbol + "graft") at the surrounding text size.
// Layer: Shared app branding primitive

import { cn } from "~/lib/utils";

const GRAFT_LOCKUP_SRC = "/graft-lockup.png";
const GRAFT_LOCKUP_ASPECT = "348 / 118";

export function GraftLockup({
  className,
  "aria-label": ariaLabel = "Graft",
}: {
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <span
      role="img"
      aria-label={ariaLabel}
      className={cn("inline-block h-[1em] max-w-full shrink-0 bg-current", className)}
      style={{
        aspectRatio: GRAFT_LOCKUP_ASPECT,
        WebkitMaskImage: `url(${GRAFT_LOCKUP_SRC})`,
        maskImage: `url(${GRAFT_LOCKUP_SRC})`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
    />
  );
}
