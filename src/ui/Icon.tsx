import type { HTMLAttributes } from 'react'
import { cx } from './utils'

export type IconSize = 'sm' | 'md' | 'lg' | 'xl'

export interface IconProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  name: string
  label?: string
  size?: IconSize
  filled?: boolean
}

export function Icon({
  name,
  label,
  size = 'md',
  filled = false,
  className,
  ...props
}: IconProps) {
  return (
    <span
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={cx(
        'material-symbols-rounded',
        'ui-icon',
        `ui-icon--${size}`,
        filled && 'ui-icon--filled',
        className,
      )}
      role={label ? 'img' : undefined}
      {...props}
    >
      {name}
    </span>
  )
}
