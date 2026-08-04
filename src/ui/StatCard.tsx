import type { ReactNode } from 'react'
import { Card, type CardTone } from './Card'
import { Chip, type ChipTone } from './Chip'
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
  trendTone = 'success',
  tone = 'surface',
  className,
}: StatCardProps) {
  return (
    <Card className={cx('stat-card', 'ui-stat-card', className)} padding="none" tone={tone}>
      <div className="ui-stat-card__topline">
        <span className="stat-label ui-stat-card__label">{label}</span>
        {icon ? (
          <span className="ui-stat-card__icon">
            <Icon name={icon} size="md" />
          </span>
        ) : null}
      </div>
      <div className="stat-value ui-stat-card__value">{value}</div>
      {detail || trend ? (
        <div className="stat-meta ui-stat-card__footer">
          {trend ? <Chip tone={trendTone}>{trend}</Chip> : null}
          {detail ? <span>{detail}</span> : null}
        </div>
      ) : null}
    </Card>
  )
}
