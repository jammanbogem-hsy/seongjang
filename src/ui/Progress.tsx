import { cx } from './utils'

export interface ProgressProps {
  value: number
  max?: number
  label?: string
  showValue?: boolean
  tone?: 'primary' | 'success' | 'warning'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function Progress({
  value,
  max = 100,
  label,
  showValue = false,
  tone = 'primary',
  size = 'md',
  className,
}: ProgressProps) {
  const safeMax = max > 0 ? max : 100
  const clamped = Math.min(Math.max(value, 0), safeMax)
  const percentage = Math.round((clamped / safeMax) * 100)

  return (
    <div className={cx('ui-progress', `ui-progress--${tone}`, `ui-progress--${size}`, className)}>
      {label || showValue ? (
        <div className="ui-progress__meta">
          {label ? <span>{label}</span> : <span />}
          {showValue ? <strong>{percentage}%</strong> : null}
        </div>
      ) : null}
      <div
        aria-label={label ?? '진행률'}
        aria-valuemax={safeMax}
        aria-valuemin={0}
        aria-valuenow={clamped}
        aria-valuetext={`${percentage}%`}
        className="progress-track ui-progress__track"
        role="progressbar"
      >
        <span className="progress-value ui-progress__bar" style={{ width: `${percentage}%` }} />
      </div>
    </div>
  )
}
