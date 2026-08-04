import type { ReactNode } from 'react'
import { SectionHeader } from '../ui/SectionHeader'
import { cx } from '../ui/utils'

export interface AdminLayoutProps {
  children: ReactNode
  title: ReactNode
  eyebrow?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  sidebar?: ReactNode
  banner?: ReactNode
  contentId?: string
  className?: string
}

export function AdminLayout({
  children,
  title,
  eyebrow,
  description,
  actions,
  sidebar,
  banner,
  contentId = 'main-content',
  className,
}: AdminLayoutProps) {
  return (
    <div className={cx('admin-layout', Boolean(sidebar) && 'admin-layout--with-sidebar', className)}>
      {sidebar ? <aside className="admin-layout__sidebar">{sidebar}</aside> : null}
      <main className="admin-layout__main" id={contentId} tabIndex={-1}>
        {banner ? <div className="admin-layout__banner">{banner}</div> : null}
        <SectionHeader
          actions={actions}
          description={description}
          eyebrow={eyebrow}
          title={title}
          titleAs="h1"
        />
        <div className="admin-layout__content">{children}</div>
      </main>
    </div>
  )
}
