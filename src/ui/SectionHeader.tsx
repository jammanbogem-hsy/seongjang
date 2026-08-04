import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './utils'

export interface SectionHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  align?: 'start' | 'center'
  titleAs?: 'h1' | 'h2' | 'h3'
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
  align = 'start',
  titleAs: Title = 'h2',
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <header className={cx('section-header', 'ui-section-header', `ui-section-header--${align}`, className)} {...props}>
      <div className="ui-section-header__copy">
        {eyebrow ? <span className="eyebrow ui-section-header__eyebrow">{eyebrow}</span> : null}
        <Title>{title}</Title>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="inline-actions ui-section-header__actions">{actions}</div> : null}
    </header>
  )
}
