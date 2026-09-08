<script setup>
import { computed } from 'vue'
import { cn } from '@/lib/utils'
import { cva } from 'class-variance-authority'
import { Loader2 } from 'lucide-vue-next'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97] [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive/20 text-destructive border border-destructive/40 hover:bg-destructive/30',
        outline:
          'border border-border bg-transparent hover:bg-secondary hover:text-secondary-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-secondary hover:text-secondary-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-9 w-9',
        'icon-sm': 'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

const props = defineProps({
  variant: { type: String, default: 'default' },
  size: { type: String, default: 'default' },
  class: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  type: { type: String, default: 'button' },
  as: { type: String, default: 'button' },
})

const isDisabled = computed(() => props.disabled || props.loading)
</script>

<template>
  <component
    :is="as"
    :type="as === 'button' ? type : undefined"
    :disabled="isDisabled || undefined"
    :class="cn(buttonVariants({ variant, size }), props.class)"
  >
    <Loader2 v-if="loading" :size="16" class="animate-spin" />
    <slot v-if="!loading" />
    <span v-if="loading" class="loading-text">
      <slot name="loading">处理中...</slot>
    </span>
  </component>
</template>
