import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './utils'

export type CardTone = 'surface' | 'subtle' | 'primary' | 'warm' | 'dark'

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'article' | 'section' | 'div'
  tone?: CardTone
  interactive?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
  children: ReactNode
}

export function Card({
  as: Component = 'div',
  tone = 'surface',
  interactive = false,
  padding = 'md',
  className,
  children,
  ...props
}: CardProps) {
  return (
    <Component
      className={cx(
        'card',
        interactive && 'interactive',
        'ui-card',
        `ui-card--${tone}`,
        `ui-card--padding-${padding}`,
        interactive && 'ui-card--interactive',
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  )
}
