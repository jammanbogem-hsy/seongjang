import type { ImgHTMLAttributes } from 'react'
import { cx } from './utils'

export type CatIllustrationVariant = 'lobby' | 'ideation' | 'timer' | 'submission' | 'exhibition'
export type CatIllustrationSize = 'sm' | 'md' | 'lg' | 'hero'

const catSources: Record<CatIllustrationVariant, string> = {
  lobby: '/assets/illustrations/cat-lobby.png',
  ideation: '/assets/illustrations/cat-ideation.png',
  timer: '/assets/illustrations/cat-timer.png',
  submission: '/assets/illustrations/cat-submission.png',
  exhibition: '/assets/illustrations/cat-exhibition.png',
}

const catDescriptions: Record<CatIllustrationVariant, string> = {
  lobby: '입장한 참가자를 반기는 픽셀 고양이',
  ideation: '아이디어를 떠올리는 픽셀 고양이',
  timer: '남은 시간을 안내하는 픽셀 고양이',
  submission: '개인 작품 제출을 돕는 픽셀 고양이',
  exhibition: '완성된 작품을 소개하는 픽셀 고양이',
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
  const legacySize = size === 'sm' ? 'cat-sm' : size === 'md' ? 'cat-md' : 'cat-lg'
  return (
    <img
      alt={decorative ? '' : (alt ?? catDescriptions[variant])}
      className={cx(
        'cat-illustration',
        'pixelated',
        legacySize,
        'ui-cat-illustration',
        `ui-cat-illustration--${size}`,
        className,
      )}
      decoding="async"
      loading={loading}
      src={catSources[variant]}
      {...props}
    />
  )
}
