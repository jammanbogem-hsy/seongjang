import type { ReactNode } from 'react'
import { Link, NavLink } from '../app/router'
import { Icon } from '../ui/Icon'
import { Chip, StatusChip } from '../ui/Chip'
import { cx } from '../ui/utils'

export interface AppNavItem {
  label: string
  to: string
  icon?: string
  end?: boolean
}

export interface AppShellProps {
  children: ReactNode
  navItems?: AppNavItem[]
  actions?: ReactNode
  brandTo?: string
  roomCode?: string
  mode?: 'organizer' | 'participant' | 'public'
  footer?: ReactNode
  className?: string
}

const modeLabels: Record<NonNullable<AppShellProps['mode']>, string> = {
  organizer: '주최자 콘솔',
  participant: '참여자',
  public: '공개 전시',
}

const modeIcons: Record<NonNullable<AppShellProps['mode']>, string> = {
  organizer: 'admin_panel_settings',
  participant: 'person',
  public: 'public',
}

function ProductMark() {
  return (
    <span aria-hidden="true" className="app-shell__mark">
      <Icon filled name="interests" size="lg" />
    </span>
  )
}

function Navigation({ items, mobile = false }: { items: AppNavItem[]; mobile?: boolean }) {
  return (
    <nav aria-label={mobile ? '모바일 주요 메뉴' : '주요 메뉴'} className={mobile ? 'app-shell__mobile-nav' : 'app-shell__nav'}>
      {items.map((item) => (
        <NavLink
          className={({ isActive }) => cx('app-shell__nav-link', isActive && 'app-shell__nav-link--active')}
          end={item.end}
          key={item.to}
          to={item.to}
        >
          {item.icon ? (
            <span className="app-shell__nav-icon">
              <Icon filled={mobile} name={item.icon} size={mobile ? 'md' : 'sm'} />
            </span>
          ) : null}
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

export function AppShell({
  children,
  navItems = [],
  actions,
  brandTo = '/',
  roomCode,
  mode,
  footer,
  className,
}: AppShellProps) {
  return (
    <div className={cx('app-shell', mode && `app-shell--${mode}`, className)}>
      <a className="app-shell__skip-link" href="#main-content">
        본문으로 건너뛰기
      </a>
      <header className="app-shell__topbar">
        <div className="app-shell__topbar-inner">
          <Link aria-label="VibeCoding 홈" className="app-shell__brand" to={brandTo}>
            <ProductMark />
            <span className="app-shell__wordmark">VibeCoding</span>
          </Link>

          <div aria-label="현재 화면 정보" className="app-shell__context">
            {mode ? (
              <Chip className="app-shell__mode-chip" icon={modeIcons[mode]}>
                {modeLabels[mode]}
              </Chip>
            ) : null}
            {roomCode ? (
              <Chip aria-label={`방 코드 ${roomCode}`} className="app-shell__room-chip" icon="meeting_room">
                {roomCode}
              </Chip>
            ) : null}
            <StatusChip className="app-shell__prototype-chip" status="prototype" />
          </div>

          {navItems.length > 0 ? <Navigation items={navItems} /> : null}
          {actions ? <div className="app-shell__actions">{actions}</div> : null}
        </div>
      </header>

      <div className="app-shell__body">{children}</div>
      {footer ? <footer className="app-shell__footer">{footer}</footer> : null}
      {navItems.length > 0 ? <Navigation items={navItems} mobile /> : null}
    </div>
  )
}
