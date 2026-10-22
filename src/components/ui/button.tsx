import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const variants=cva('inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50', {variants:{variant:{default:'bg-neutral-900 text-white hover:bg-neutral-700',outline:'border border-neutral-200 bg-white hover:bg-neutral-50'},size:{default:'h-9 px-4',sm:'h-8 px-3'}},defaultVariants:{variant:'default',size:'default'}});
export function Button({className,variant,size,asChild=false,...props}:React.ComponentProps<'button'>&VariantProps<typeof variants>&{asChild?:boolean}){const Comp=asChild?Slot:'button';return <Comp className={cn(variants({variant,size}),className)} {...props}/>}
