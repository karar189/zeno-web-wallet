import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import type { SoundName } from "@/lib/sound"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-none border bg-clip-padding text-[11px] font-medium tracking-[0.14em] uppercase whitespace-nowrap transition-colors outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffc14a] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border-[#ffc14a] bg-[#ffc14a] text-[#140e08] hover:bg-[#ffe08a] hover:border-[#ffe08a]",
        outline:
          "border-[rgba(244,241,234,0.28)] bg-transparent text-[#f7f4ef] hover:border-[#ffc14a] hover:text-[#ffc14a]",
        secondary:
          "border-transparent bg-[#14110c] text-[#f7f4ef] hover:bg-[#1a1610]",
        ghost: "border-transparent text-[#f7f4ef] hover:bg-[#ffffff0a]",
        destructive:
          "border-[#c45c4a] bg-transparent text-[#e7a598] hover:bg-[#c45c4a] hover:text-[#071018]",
        link: "border-transparent text-[#ffc14a] tracking-normal normal-case underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 gap-1.5 px-5",
        xs: "h-7 gap-1 px-2 text-[10px]",
        sm: "h-9 gap-1 px-3.5 text-[10px]",
        lg: "h-12 gap-1.5 px-6",
        icon: "size-11",
        "icon-xs": "size-7",
        "icon-sm": "size-9",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  sound = "tap",
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & { sound?: SoundName | "none" }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-sound={sound}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
