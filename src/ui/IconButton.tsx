import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Icon, type IconSize } from './Icon'
import { cx } from './utils'

export type IconButtonVariant = 'standard' | 'tonal' | 'outlined' | 'filled'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: string
  label: string
  iconSize?: IconSize
  variant?: IconButtonVariant
  selected?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    label,
    iconSize = 'md',
    variant = 'standard',
    selected = false,
    className,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      aria-label={label}
      aria-pressed={selected || undefined}
      className={cx(
        'icon-btn',
        'ui-icon-button',
        `ui-icon-button--${variant}`,
        selected && 'ui-icon-button--selected',
        className,
      )}
      ref={ref}
      title={label}
      type={type}
      {...props}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  )
})
