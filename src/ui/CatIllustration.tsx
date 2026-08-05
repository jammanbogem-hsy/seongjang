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
export type CatIllustrationSize = 'xs' | 'sm' | 'md' | 'lg' | 'hero'

const catSources: Record<CatIllustrationVariant, string> = {
  lobby: '/assets/illustrations/cat-lobby.png',
  ideation: '/assets/illustrations/cat-ideation.png',
  timer: '/assets/illustrations/cat-timer.png',
  submission: '/assets/illustrations/cat-submission.png',
  exhibition: '/assets/illustrations/cat-exhibition.png',
  welcome: '/assets/mascots/cat-welcome.png',
  autosave: '/assets/mascots/cat-autosave.png',
  comment: '/assets/mascots/cat-comment.png',
  review: '/assets/mascots/cat-review.png',
  sync: '/assets/mascots/cat-sync.png',
  focus: '/assets/mascots/cat-focus.png',
  deadline: '/assets/mascots/cat-deadline.png',
  empty: '/assets/mascots/cat-empty.png',
  saved: '/assets/mascots/cat-saved.png',
  celebrate: '/assets/mascots/cat-celebrate.png',
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
