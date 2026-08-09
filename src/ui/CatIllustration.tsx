import type { ImgHTMLAttributes } from 'react'
import { cx } from './utils'

export type CatIllustrationVariant =
  | 'lobby'
  | 'ideation'
  | 'timer'
  | 'submission'
  | 'exhibition'
  | 'welcome'
  | 'autosave'
  | 'comment'
  | 'review'
  | 'sync'
  | 'focus'
  | 'deadline'
  | 'empty'
  | 'saved'
  | 'celebrate'
  | 'reply'
  | 'reaction'
  | 'presenter'
  | 'room-code'
  | 'invite'
  | 'dashboard'
  | 'export'
  | 'curator'
  | 'search'
  | 'security'
  | 'teamwork'
  | 'upload'
  | 'pin-help'
  | 'break'
  | 'timer-start'
export type CatIllustrationSize = 'xs' | 'sm' | 'md' | 'lg' | 'hero'

const catSources: Record<CatIllustrationVariant, string> = {
  lobby: '/assets/illustrations/cat-lobby.webp',
  ideation: '/assets/illustrations/cat-ideation.webp',
  timer: '/assets/illustrations/cat-timer.webp',
  submission: '/assets/illustrations/cat-submission.webp',
  exhibition: '/assets/illustrations/cat-exhibition.webp',
  welcome: '/assets/mascots/cat-welcome.webp',
  autosave: '/assets/mascots/cat-autosave.webp',
  comment: '/assets/mascots/cat-comment.webp',
  review: '/assets/mascots/cat-review.webp',
  sync: '/assets/mascots/cat-sync.webp',
  focus: '/assets/mascots/cat-focus.webp',
  deadline: '/assets/mascots/cat-deadline.webp',
  empty: '/assets/mascots/cat-empty.webp',
  saved: '/assets/mascots/cat-saved.webp',
  celebrate: '/assets/mascots/cat-celebrate.webp',
  reply: '/assets/mascots/cat-reply.webp',
  reaction: '/assets/mascots/cat-reaction.webp',
  presenter: '/assets/mascots/cat-presenter.webp',
  'room-code': '/assets/mascots/cat-room-code.webp',
  invite: '/assets/mascots/cat-invite.webp',
  dashboard: '/assets/mascots/cat-dashboard.webp',
  export: '/assets/mascots/cat-export.webp',
  curator: '/assets/mascots/cat-curator.webp',
  search: '/assets/mascots/cat-search.webp',
  security: '/assets/mascots/cat-security.webp',
  teamwork: '/assets/mascots/cat-teamwork.webp',
  upload: '/assets/mascots/cat-upload.webp',
  'pin-help': '/assets/mascots/cat-pin-help.webp',
  break: '/assets/mascots/cat-break.webp',
  'timer-start': '/assets/mascots/cat-timer-start.webp',
}

const catDescriptions: Record<CatIllustrationVariant, string> = {
  lobby: '입장한 참가자를 반기는 픽셀 고양이',
  ideation: '아이디어를 떠올리는 픽셀 고양이',
  timer: '남은 시간을 안내하는 픽셀 고양이',
  submission: '개인 작품 제출을 돕는 픽셀 고양이',
  exhibition: '완성된 작품을 소개하는 픽셀 고양이',
  welcome: '손을 흔들며 참여자를 반기는 픽셀 고양이',
  autosave: '노트북으로 자동 저장을 돕는 픽셀 고양이',
  comment: '연필과 말풍선으로 댓글을 안내하는 픽셀 고양이',
  review: '돋보기로 참여자 자료를 검토하는 픽셀 고양이',
  sync: '화면 동기화 상태를 안내하는 픽셀 고양이',
  focus: '아이디어에 집중하는 픽셀 고양이',
  deadline: '남은 시간을 차분하게 알려주는 픽셀 고양이',
  empty: '첫 자료를 기다리는 픽셀 고양이',
  saved: '저장 완료를 확인해주는 픽셀 고양이',
  celebrate: '제출 완료를 축하하는 픽셀 고양이',
  reply: '대화의 답장을 안내하는 픽셀 고양이',
  reaction: '청중 반응을 보여주는 픽셀 고양이',
  presenter: '슬라이드를 발표하는 픽셀 고양이',
  'room-code': '방 코드 입장을 안내하는 픽셀 고양이',
  invite: '관리자 초대장을 전하는 픽셀 고양이',
  dashboard: '수합 대시보드를 정리하는 픽셀 고양이',
  export: '행사 기록 내보내기를 돕는 픽셀 고양이',
  curator: '작품 전시를 큐레이션하는 픽셀 고양이',
  search: '참여자와 콘텐츠를 찾는 픽셀 고양이',
  security: '계정과 세션을 지키는 픽셀 고양이',
  teamwork: '참여자의 기록을 연결하는 픽셀 고양이',
  upload: '작품 파일 업로드를 돕는 픽셀 고양이',
  'pin-help': '개인 입장코드 확인을 돕는 픽셀 고양이',
  break: '세션을 마치고 쉬는 픽셀 고양이',
  'timer-start': '타이머 시작을 알리는 픽셀 고양이',
}

export interface CatIllustrationProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  variant: CatIllustrationVariant
  size?: CatIllustrationSize
  decorative?: boolean
}

export function CatIllustration({
  variant,
  size = 'md',
  decorative = false,
  alt,
  className,
  loading = 'lazy',
  ...props
}: CatIllustrationProps) {
  const legacySize = size === 'xs' || size === 'sm' ? 'cat-sm' : size === 'md' ? 'cat-md' : 'cat-lg'
  return (
    <img
      {...props}
      alt={decorative ? '' : (alt ?? catDescriptions[variant])}
      aria-hidden={decorative || undefined}
      className={cx(
        'cat-illustration',
        'pixelated',
        legacySize,
        'ui-cat-illustration',
        `ui-cat-illustration--${size}`,
        className,
      )}
      decoding="async"
      draggable={false}
      loading={loading}
      src={catSources[variant]}
    />
  )
}
