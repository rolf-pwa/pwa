import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/shared/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[0.6875rem] font-medium uppercase tracking-[0.08em] transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        accent: "border-transparent bg-accent text-accent-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        muted: "border-transparent bg-muted text-muted-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "border-border text-muted-foreground",
        // Status pairs from the Brand & Interface Guide: a tint of the colour, the colour as text, and always a word.
        success: "border-transparent bg-spruce/10 text-spruce dark:bg-bronze-light/15 dark:text-slate-300",
        warning: "border-transparent bg-bronze-ink/10 text-bronze-ink dark:bg-bronze-light/15 dark:text-bronze-light",
        error: "border-transparent bg-brick/10 text-brick dark:bg-brick/25 dark:text-slate-300",
        info: "border-transparent bg-midnight/10 text-midnight dark:bg-slate-300/15 dark:text-slate-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
