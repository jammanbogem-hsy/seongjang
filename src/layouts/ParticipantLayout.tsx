import type { ReactNode } from 'react'
import { Progress } from '../ui/Progress'
import { SectionHeader } from '../ui/SectionHeader'
import { cx } from '../ui/utils'

export interface ParticipantLayoutProps {
  children: ReactNode
  title: ReactNode
  eyebrow?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  aside?: ReactNode
  stickyActions?: ReactNode
  progress?: { current: number; total: number; label?: string }
  contentId?: string
  className?: string
}

export function ParticipantLayout({
  children,
  title,
  eyebrow,
  description,
  actions,
  aside,
  stickyActions,
  progress,
  contentId = 'main-content',
  className,
}: ParticipantLayoutProps) {
  return (
    <main
      className={cx('participant-layout', Boolean(aside) && 'participant-layout--with-aside', className)}
      id={contentId}
      tabIndex={-1}
    >
      <div className="participant-layout__content">
        {progress ? (
          <Progress
            label={progress.label ?? `${progress.current} / ${progress.total} 단계`}
            max={progress.total}
            value={progress.current}
          />
        ) : null}
        <SectionHeader
          actions={actions}
          description={description}
          eyebrow={eyebrow}
          title={title}
          titleAs="h1"
        />
        <div className="participant-layout__workspace">{children}</div>
      </div>
      {aside ? <aside className="participant-layout__aside">{aside}</aside> : null}
      {stickyActions ? <div className="participant-layout__sticky-actions">{stickyActions}</div> : null}
    </main>
  )
}
