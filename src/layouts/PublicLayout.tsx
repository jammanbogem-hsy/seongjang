import type { ReactNode } from 'react'
import { Link } from '../app/router'
import { AppShell, type AppNavItem } from './AppShell'
import { Icon } from '../ui/Icon'
import { cx } from '../ui/utils'

export interface PublicLayoutProps {
  children: ReactNode
  navItems?: AppNavItem[]
  actions?: ReactNode
  roomCode?: string
  contentClassName?: string
}

export function PublicLayout({
  children,
  navItems = [],
  actions,
  roomCode,
  contentClassName,
}: PublicLayoutProps) {
  const footer = (
    <div className="public-layout__footer-inner">
      <div>
        <strong>VibeCoding</strong>
        <p>한 사람의 생각부터 모두의 기록까지.</p>
      </div>
      <Link to="/">
        서비스 소개
        <Icon name="arrow_outward" size="sm" />
      </Link>
    </div>
  )

  return (
    <AppShell actions={actions} footer={footer} mode="public" navItems={navItems} roomCode={roomCode}>
      <main className={cx('public-layout__content', contentClassName)} id="main-content" tabIndex={-1}>
        {children}
      </main>
    </AppShell>
  )
}
