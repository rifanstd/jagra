import type { ComponentProps } from "react";
import { cn } from "@renderer/lib/utils";

/**
 * A link-looking button for actions inside text, such as opening an official page in the browser.
 * Links are `secondary`, because `primary` is for the main action only (design/system/README.md).
 */
export function TextLink({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-sm text-secondary underline underline-offset-3 hover:no-underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none dark:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
