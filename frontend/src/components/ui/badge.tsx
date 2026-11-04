import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-none border px-2 py-0.5 text-[10px] font-medium tracking-[0.16em] uppercase whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e4c27a] [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "border-[#e4c27a]/70 bg-transparent text-[#e4c27a]",
        secondary: "border-[#f4f1ea]/50 bg-transparent text-[#f4f1ea]",
        destructive: "border-[#c45c4a] bg-transparent text-[#e7a598]",
        outline: "border-[#f4f1ea]/40 bg-transparent text-[#f4f1ea]/80",
        ghost: "border-transparent text-[#f4f1ea]/70",
        link: "border-transparent text-[#e4c27a] tracking-normal normal-case underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
