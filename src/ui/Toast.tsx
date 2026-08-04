import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { IconButton } from './IconButton'
import { cx } from './utils'

export type ToastTone = 'info' | 'success' | 'warning' | 'danger'

export interface ToastMessage {
  id: string
  message: ReactNode
  tone?: ToastTone
  actionLabel?: string
  onAction?: () => void
}

export interface ToastRegionProps {
  messages: ToastMessage[]
  onDismiss: (id: string) => void
  label?: string
}

const toastIcons: Record<ToastTone, string> = {
  info: 'info',
  success: 'check_circle',
  warning: 'warning',
  danger: 'error',
}

export function ToastRegion({ messages, onDismiss, label = '알림' }: ToastRegionProps) {
  return (
    <section aria-label={label} aria-live="polite" className="toast-region ui-toast-region">
      {messages.map((toast) => {
        const tone = toast.tone ?? 'info'
        return (
          <div className={cx('toast', 'ui-toast', `ui-toast--${tone}`)} key={toast.id} role="status">
            <Icon name={toastIcons[tone]} size="sm" />
            <div className="ui-toast__message">{toast.message}</div>
            {toast.actionLabel && toast.onAction ? (
              <button className="ui-toast__action" onClick={toast.onAction} type="button">
                {toast.actionLabel}
              </button>
            ) : null}
            <IconButton icon="close" label="알림 닫기" onClick={() => onDismiss(toast.id)} />
          </div>
        )
      })}
    </section>
  )
}
