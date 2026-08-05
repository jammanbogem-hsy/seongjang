import type { ReactNode } from 'react'
import { CatIllustration, type CatIllustrationVariant } from './CatIllustration'
import { cx } from './utils'

export interface MascotActionProps {
  children: ReactNode
  className?: string
  compactOnly?: boolean
  label: string
  variant: CatIllustrationVariant
}

export function MascotAction({ children, className, compactOnly = false, label, variant }: MascotActionProps) {
  return (
    <div className={cx('mascot-action', compactOnly && 'mascot-action--compact-only', className)}>
      <span className="mascot-action__buddy">
        <CatIllustration decorative size="xs" variant={variant} />
        <span>{label}</span>
      </span>
      <div className="button-row mascot-action__buttons">{children}</div>
    </div>
  )
}

export interface MascotCueProps {
  className?: string
  description: string
  title: string
  variant: CatIllustrationVariant
}

export function MascotCue({ className, description, title, variant }: MascotCueProps) {
  return (
    <aside className={cx('mascot-cue', className)}>
      <CatIllustration decorative size="sm" variant={variant} />
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </aside>
  )
}
