import type { AutosavePhase } from '../platform/useAutosave'
import { Icon } from './Icon'

const labels: Record<AutosavePhase, string> = {
  idle: '입력하면 자동 저장됩니다',
  saving: '저장 중…',
  pending: 'Firebase 서버 확인 중…',
  saved: '모든 변경사항 저장됨',
  offline: '오프라인 · Firebase 전송 대기 중',
  stale: '저장된 사본 표시 중 · 서버 확인 필요',
  conflict: '다른 기기의 변경사항을 확인해주세요',
  error: '저장 실패 · 다시 입력해 재시도',
}

const icons: Record<AutosavePhase, string> = {
  idle: 'cloud_queue',
  saving: 'progress_activity',
  pending: 'sync',
  saved: 'cloud_done',
  offline: 'cloud_off',
  stale: 'history',
  conflict: 'difference',
  error: 'error',
}

export function AutosaveStatus({ phase, savedAt }: { phase: AutosavePhase; savedAt?: Date | null }) {
  const time = savedAt?.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  return (
    <span aria-live="polite" className={`autosave-status autosave-status--${phase}`} role="status">
      <Icon name={icons[phase]} size="sm" />
      <span>{labels[phase]}{phase === 'saved' && time ? ` · ${time}` : ''}</span>
    </span>
  )
}
