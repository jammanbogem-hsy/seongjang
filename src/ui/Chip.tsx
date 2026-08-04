import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { Icon } from './Icon'
import { cx } from './utils'

export type ChipTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

interface ChipBaseProps {
  children: ReactNode
  tone?: ChipTone
  icon?: string
  selected?: boolean
  className?: string
}

export type ChipProps = ChipBaseProps &
  (
    | ({ onClick?: undefined } & HTMLAttributes<HTMLSpanElement>)
    | ({ onClick: ButtonHTMLAttributes<HTMLButtonElement>['onClick'] } & Omit<
        ButtonHTMLAttributes<HTMLButtonElement>,
        'children'
      >)
  )

export function Chip({
  children,
  tone = 'neutral',
  icon,
  selected = false,
  className,
  onClick,
  ...props
}: ChipProps) {
  const classes = cx(
    'chip',
    tone === 'primary' && 'primary',
    tone === 'success' && 'success',
    (tone === 'warning' || tone === 'danger') && 'warm',
    tone === 'info' && 'primary',
    'ui-chip',
    `ui-chip--${tone}`,
    selected && 'ui-chip--selected',
    onClick && 'ui-chip--action',
    className,
  )
  const content = (
    <>
      {icon ? <Icon name={icon} size="sm" /> : null}
      <span>{children}</span>
    </>
  )

  if (onClick) {
    return (
      <button
        aria-pressed={selected || undefined}
        className={classes}
        onClick={onClick}
        type="button"
        {...(props as ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {content}
      </button>
    )
  }

  return (
    <span className={classes} {...(props as HTMLAttributes<HTMLSpanElement>)}>
      {content}
    </span>
  )
}

export interface StatusChipProps extends Omit<ChipBaseProps, 'children' | 'icon'> {
  status: 'live' | 'ready' | 'waiting' | 'complete' | 'locked' | 'prototype'
  label?: string
}

const statusMeta: Record<StatusChipProps['status'], { icon: string; label: string; tone: ChipTone }> = {
  live: { icon: 'radio_button_checked', label: '진행 중', tone: 'danger' },
  ready: { icon: 'check_circle', label: '준비됨', tone: 'success' },
  waiting: { icon: 'schedule', label: '대기 중', tone: 'warning' },
  complete: { icon: 'task_alt', label: '완료', tone: 'success' },
  locked: { icon: 'lock', label: '잠김', tone: 'neutral' },
  prototype: { icon: 'science', label: 'Prototype', tone: 'info' },
}

export function StatusChip({ status, label, ...props }: StatusChipProps) {
  const meta = statusMeta[status]
  return (
    <Chip icon={meta.icon} tone={meta.tone} {...props}>
      {label ?? meta.label}
    </Chip>
  )
}
