import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from '../app/router'
import type { CommandResult } from '../domain/models'
import { AppShell, type AppNavItem } from '../layouts'
import { Button, Card, CatIllustration, Chip, Icon, ToastRegion, type ToastMessage } from '../ui'
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
  const {
    authEmail,
    authRole,
    backendError,
    backendPhase,
    signInOrganizer,
    signOut,
    state,
  } = usePlatform()
  const [signingIn, setSigningIn] = useState(false)
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    if (authRole !== 'owner' && authRole !== 'admin') return undefined
    const idleTimeoutMs = 30 * 60 * 1_000
    let timeoutId = 0
    const resetIdleTimeout = () => {
      window.clearTimeout(timeoutId)
      timeoutId = window.setTimeout(() => { void signOut() }, idleTimeoutMs)
    }
    const activityEvents: Array<keyof WindowEventMap> = ['keydown', 'pointerdown', 'scroll']
    activityEvents.forEach((eventName) => window.addEventListener(eventName, resetIdleTimeout, { passive: true }))
    resetIdleTimeout()
    return () => {
      window.clearTimeout(timeoutId)
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, resetIdleTimeout))
    }
  }, [authRole, signOut])

  const connectOrganizer = async () => {
    setSigningIn(true)
    setAuthError('')
    const result = await signInOrganizer()
    if (!result.ok) setAuthError(result.error.message)
    setSigningIn(false)
  }

  if (authRole !== 'owner' && authRole !== 'admin') {
    return (
      <AppShell brandTo="/" mode="organizer" roomCode={state.room.code}>
        <main className="page narrow" id="main-content">
          <Card className="empty-state identity-gate" padding="lg">
            <CatIllustration decorative size="lg" variant="review" />
            <Chip icon="verified_user" tone="primary">Firebase 관리자 인증</Chip>
            <h1>주최자 권한을 확인해주세요.</h1>
            <p>초대받은 Google 계정으로 로그인하면 참여자 자료와 비공개 검토를 안전하게 불러옵니다.</p>
            <Button
              className="identity-gate__primary"
              disabled={signingIn}
              leadingIcon="login"
              onClick={() => { void connectOrganizer() }}
              size="lg"
            >
              {signingIn ? '권한 확인 중…' : 'Google로 주최자 로그인'}
            </Button>
            {authError || backendError ? <p className="field-error" role="alert">{authError || backendError}</p> : null}
          </Card>
        </main>
      </AppShell>
    )
  }
  return (
    <AppShell
      actions={
        <div className="button-row">
          <Chip icon={backendPhase === 'ready' ? 'cloud_done' : 'cloud_sync'} tone="success">
            {backendPhase === 'ready' ? 'Firebase 연결됨' : '동기화 중'}
          </Chip>
          <Button leadingIcon="logout" onClick={() => { void signOut() }} size="sm" variant="text">
            {authEmail ? `${authEmail} 로그아웃` : '로그아웃'}
          </Button>
        </div>
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
  const { currentParticipant, signOut, state } = usePlatform()
  return (
    <AppShell
      actions={currentParticipant ? (
        <Button
          leadingIcon="person_add"
          onClick={() => {
            void signOut().then(() => navigate(`/join/${state.room.code}`))
          }}
          size="sm"
          variant="text"
        >
          다른 닉네임
        </Button>
      ) : undefined}
      brandTo={`/events/${EVENT_ID}/live`}
      mode="participant"
      navItems={participantNav}
      roomCode={state.room.code}
    >
      <div className="session-strip" role="status">
        <span className="session-strip__signal"><Icon filled name="sensors" size="sm" /></span>
        <strong>{currentParticipant?.nickname ?? '입장 전'}</strong>
        <span>{currentParticipant ? '님의 참여 화면 · 주최자의 진행과 실시간으로 동기화됩니다' : '· 닉네임과 PIN을 만들면 행사에 참여할 수 있습니다'}</span>
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
        <Button className="keep-mobile" leadingIcon="login" onClick={() => navigate(`/join/${state.room.code}`)} variant="outlined">
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
        <span>참여자의 기록과 공개 범위를 소중하게 보호합니다.</span>
      </footer>
    </AppShell>
  )
}
