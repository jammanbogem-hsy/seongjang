import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Icon } from './Icon'
import { cx } from './utils'

export type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  leadingIcon?: string | ReactNode
  trailingIcon?: string | ReactNode
  loading?: boolean
  fullWidth?: boolean
}

function renderAdornment(adornment: string | ReactNode) {
  return typeof adornment === 'string' ? <Icon name={adornment} size="sm" /> : adornment
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'filled',
    size = 'md',
    leadingIcon,
    trailingIcon,
    loading = false,
    fullWidth = false,
    disabled,
    className,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  const legacyVariant = {
    filled: 'primary',
    tonal: 'tonal',
    outlined: 'outline',
    text: 'ghost',
    danger: 'danger',
  }[variant]

  return (
    <button
      className={cx(
        'btn',
        legacyVariant,
        size === 'sm' && 'small',
        'ui-button',
        `ui-button--${variant}`,
        `ui-button--${size}`,
        fullWidth && 'ui-button--full-width',
        loading && 'ui-button--loading',
        className,
      )}
      disabled={disabled || loading}
      ref={ref}
      type={type}
      {...props}
    >
      {loading ? (
        <span aria-hidden="true" className="ui-button__spinner" />
      ) : leadingIcon ? (
        <span className="ui-button__icon">{renderAdornment(leadingIcon)}</span>
      ) : null}
      <span className="ui-button__label">{children}</span>
      {trailingIcon ? (
        <span className="ui-button__icon">{renderAdornment(trailingIcon)}</span>
      ) : null}
    </button>
  )
})
