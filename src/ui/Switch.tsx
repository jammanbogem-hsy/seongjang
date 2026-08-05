import { Icon } from './Icon'
import { cx } from './utils'

export interface SwitchProps {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: (checked: boolean) => void
}

export function Switch({ checked, disabled = false, label, onChange }: SwitchProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cx('ui-switch', checked && 'ui-switch--checked')}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span className="ui-switch__thumb">{checked ? <Icon name="check" size="sm" /> : null}</span>
    </button>
  )
}
