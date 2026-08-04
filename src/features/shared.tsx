import { useCallback, useState, type ReactNode } from 'react'
import { useNavigate } from '../app/router'
import type { CommandResult } from '../domain/models'
import { AppShell, type AppNavItem } from '../layouts'
import { Button, Icon, ToastRegion, type ToastMessage } from '../ui'
import { usePlatform } from '../app/PlatformProvider'

export const EVENT_ID = 'room-vibe26'
export const PUBLIC_SLUG = 'vibecoding-2026'

export const organizerNav: AppNavItem[] = [
  { label: '라이브', to: `/admin/events/${EVENT_ID}/control`, icon: 'present_to_all' },
  { label: '참여자', to: `/admin/events/${EVENT_ID}/participants`, icon: 'group' },
  { label: '정리', to: `/admin/events/${EVENT_ID}/synthesis`, icon: 'dashboard' },
  { label: '작품', to: `/admin/events/${EVENT_ID}/submissions`, icon: 'gallery_thumbnail' },
  { label: '연결', to: `/admin/events/${EVENT_ID}/portability`, icon: 'hub' },
]

export const participantNav: AppNavItem[] = [
  { label: '라이브', to: `/events/${EVENT_ID}/live`, icon: 'live_tv' },
  { label: '내 작품', to: `/events/${EVENT_ID}/submission`, icon: 'rocket_launch' },
  { label: '전시', to: `/exhibitions/${PUBLIC_SLUG}`, icon: 'museum' },
]

export const publicNav: AppNavItem[] = [
  { label: '수합 대시보드', to: `/dashboards/${PUBLIC_SLUG}`, icon: 'dashboard' },
  { label: '작품 전시', to: `/exhibitions/${PUBLIC_SLUG}`, icon: 'museum' },
]

export function formatTimer(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(value))
}

export function useNotices() {
  const [messages, setMessages] = useState<ToastMessage[]>([])
  const notify = useCallback((message: ReactNode, tone: ToastMessage['tone'] = 'success') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`
    setMessages((current) => [...current, { id, message, tone }].slice(-3))
    window.setTimeout(() => setMessages((current) => current.filter((item) => item.id !== id)), 3600)
  }, [])
  const renderToasts = () => (
    <ToastRegion
      messages={messages}
      onDismiss={(id) => setMessages((current) => current.filter((item) => item.id !== id))}
    />
  )
  return { notify, renderToasts }
}

export function announceResult<T>(
  result: CommandResult<T>,
  notify: (message: ReactNode, tone?: ToastMessage['tone']) => void,
  fallback = '변경사항을 저장했어요.',
): boolean {
  if (result.ok) {
    notify(result.notice ?? fallback, 'success')
    return true
  }
  notify(result.error.message, 'danger')
  return false
}

export function OrganizerShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { state } = usePlatform()
  return (
    <AppShell
      actions={
        <>
          <Button
            className="keep-mobile"
            leadingIcon="open_in_new"
            onClick={() => window.open(`/events/${EVENT_ID}/live`, '_blank', 'noopener,noreferrer')}
            size="sm"
            variant="tonal"
          >
            참여자 화면
          </Button>
          <Button leadingIcon="home" onClick={() => navigate('/')} size="sm" variant="text">
            홈
          </Button>
        </>
      }
      brandTo={`/admin/events/${EVENT_ID}/control`}
      mode="organizer"
      navItems={organizerNav}
      roomCode={state.room.code}
    >
      {children}
    </AppShell>
  )
}

export function ParticipantShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { currentParticipant, state } = usePlatform()
  return (
    <AppShell
      actions={
        <Button className="keep-mobile" leadingIcon="swap_horiz" onClick={() => navigate(`/admin/events/${EVENT_ID}/control`)} size="sm" variant="tonal">
          역할 전환
        </Button>
      }
      brandTo={`/events/${EVENT_ID}/live`}
      mode="participant"
      navItems={participantNav}
      roomCode={state.room.code}
    >
      <div className="session-strip" role="status">
        <span className="live-dot" />
        <strong>{currentParticipant?.nickname ?? '게스트'}</strong>
        <span>님의 탭 · 다른 탭의 주최자 제어와 동기화됩니다</span>
        <Icon name="sync" size="sm" />
      </div>
      {children}
    </AppShell>
  )
}

export function PublicShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { state } = usePlatform()
  return (
    <AppShell
      actions={
        <Button className="keep-mobile" leadingIcon="login" onClick={() => navigate(`/join/${state.room.code}`)} size="sm" variant="outlined">
          방 입장
        </Button>
      }
      mode="public"
      navItems={publicNav}
      roomCode={state.room.code}
    >
      {children}
      <footer className="site-footer">
        <div>
          <strong>VibeCoding</strong>
          <p>한 사람의 생각부터 모두의 기록까지.</p>
        </div>
        <span>Prototype · Firebase 운영판 연결 예정</span>
      </footer>
    </AppShell>
  )
}
