import type { ReactNode } from 'react'
import { Card, type CardTone } from './Card'
import type { ChipTone } from './Chip'
import { Icon } from './Icon'
import { cx } from './utils'

export interface StatCardProps {
  label: string
  value: ReactNode
  detail?: ReactNode
  icon?: string
  trend?: string
  trendTone?: ChipTone
  tone?: CardTone
  className?: string
}

export function StatCard({
  label,
  value,
  detail,
  icon,
  trend,
  tone = 'surface',
  className,
}: StatCardProps) {
  const supportingText = trend ?? detail

  return (
    <Card as="article" className={cx('stat-card', 'ui-stat-card', className)} padding="md" tone={tone}>
      <div className="ui-stat-card__topline">
        {icon ? (
          <span className="ui-stat-card__icon">
            <Icon name={icon} size="md" />
          </span>
        ) : null}
        <span className="stat-label ui-stat-card__label">{label}</span>
      </div>
      <div className="stat-value ui-stat-card__value">{value}</div>
      {supportingText ? <div className="stat-meta ui-stat-card__footer">{supportingText}</div> : null}
    </Card>
  )
}
