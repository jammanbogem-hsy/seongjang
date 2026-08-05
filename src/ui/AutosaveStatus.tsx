import type { AutosavePhase } from '../platform/useAutosave'
import { Icon } from './Icon'

const labels: Record<AutosavePhase, string> = {
  idle: '입력하면 자동 저장됩니다',
  saving: '저장 중…',
  saved: '모든 변경사항 저장됨',
  offline: '오프라인 · 이 기기에 저장됨',
  error: '저장 실패 · 다시 입력해 재시도',
}

const icons: Record<AutosavePhase, string> = {
  idle: 'cloud_queue',
  saving: 'progress_activity',
  saved: 'cloud_done',
  offline: 'cloud_off',
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
