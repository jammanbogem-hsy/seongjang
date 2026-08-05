import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import './ebook.css'

GlobalWorkerOptions.workerSrc = pdfWorker

const PDF_URL = '/ebook/lecture.pdf?v=20260805-4'

const PATTERN_CAT_ARTWORKS = [
  '/assets/illustrations/cat-exhibition.png',
  '/assets/mascots/cat-focus.png',
  '/assets/mascots/cat-celebrate.png',
  '/assets/illustrations/cat-lobby.png',
  '/assets/mascots/cat-autosave.png',
  '/assets/mascots/cat-review.png',
  '/assets/illustrations/cat-ideation.png',
  '/assets/mascots/cat-sync.png',
  '/assets/mascots/cat-comment.png',
  '/assets/illustrations/cat-timer.png',
  '/assets/mascots/cat-saved.png',
  '/assets/illustrations/cat-submission.png',
  '/assets/mascots/cat-empty.png',
  '/assets/mascots/cat-deadline.png',
  '/assets/mascots/cat-welcome.png',
]

const PATTERN_CATS = [...PATTERN_CAT_ARTWORKS, ...[...PATTERN_CAT_ARTWORKS].reverse()]

type TurnDirection = 'next' | 'previous'

function clampPage(page: number, total: number) {
  return Math.min(Math.max(1, page), total)
}

function usePageTurnSound(enabled: boolean) {
  const audioContextRef = useRef<AudioContext | null>(null)

  return useCallback(() => {
    if (!enabled) return

    const AudioContextClass = window.AudioContext
    const context = audioContextRef.current ?? new AudioContextClass()
    audioContextRef.current = context
    void context.resume()

    const length = Math.floor(context.sampleRate * 0.42)
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const data = buffer.getChannelData(0)

    for (let index = 0; index < length; index += 1) {
      const progress = index / length
      const envelope = Math.sin(Math.PI * progress) * (1 - progress * 0.42)
      data[index] = (Math.random() * 2 - 1) * envelope
    }

    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    source.buffer = buffer
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(1180, context.currentTime)
    filter.frequency.exponentialRampToValueAtTime(420, context.currentTime + 0.4)
    filter.Q.value = 0.7
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.27, context.currentTime + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42)
    source.connect(filter).connect(gain).connect(context.destination)
    source.start()
  }, [enabled])
}

export function EbookPage() {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [currentImage, setCurrentImage] = useState<string | null>(null)
  const [nextImage, setNextImage] = useState<string | null>(null)
  const [pendingPage, setPendingPage] = useState<number | null>(null)
  const [turnDirection, setTurnDirection] = useState<TurnDirection | null>(null)
  const [loadingLabel, setLoadingLabel] = useState('책장을 준비하고 있어요')
  const [error, setError] = useState<string | null>(null)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const renderCache = useRef(new Map<number, Promise<string>>())
  const viewerRef = useRef<HTMLElement>(null)
  const pointerStart = useRef<number | null>(null)
  const playPageTurn = usePageTurnSound(soundEnabled)
  const pageCount = pdf?.numPages ?? 24
  const isBusy = !currentImage || pendingPage !== null
  const showLoader = !currentImage || (pendingPage !== null && !nextImage)

  useEffect(() => {
    const previousTitle = document.title
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    const previousDescription = description?.content
    document.title = '교사 개발자 해커톤 (성장형) | 온라인 책자'
    if (description) description.content = '교사 개발자 해커톤 성장형 강의 원고를 PDF 원문 그대로 읽는 온라인 책자'
    document.body.classList.add('ebook-body')

    return () => {
      document.title = previousTitle
      if (description && previousDescription) description.content = previousDescription
      document.body.classList.remove('ebook-body')
    }
  }, [])

  useEffect(() => {
    const loaderCat = new Image()
    loaderCat.src = '/assets/retro/retro-cat-recharging-break.png'
    void loaderCat.decode().catch(() => undefined)
  }, [])

  useEffect(() => {
    let active = true
    const task = getDocument(PDF_URL)

    void task.promise
      .then((document) => {
        if (!active) return
        setPdf(document)
        setLoadingLabel('첫 페이지를 펼치고 있어요')
      })
      .catch(() => {
        if (!active) return
        setError('책자 파일을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
      })

    return () => {
      active = false
      void task.destroy()
    }
  }, [])

  const renderPage = useCallback((pageNumber: number) => {
    if (!pdf) return Promise.reject(new Error('PDF is not ready'))
    const cached = renderCache.current.get(pageNumber)
    if (cached) return cached

    const rendered = pdf.getPage(pageNumber).then(async (pdfPage) => {
      const naturalViewport = pdfPage.getViewport({ scale: 1 })
      const targetWidth = Math.min(2200, Math.max(1500, window.innerWidth * window.devicePixelRatio * 0.92))
      const viewport = pdfPage.getViewport({ scale: targetWidth / naturalViewport.width })
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('Canvas is unavailable')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await pdfPage.render({ canvas, canvasContext: context, viewport }).promise
      return canvas.toDataURL('image/jpeg', 0.94)
    })

    renderCache.current.set(pageNumber, rendered)
    return rendered
  }, [pdf])

  useEffect(() => {
    if (!pdf || currentImage) return
    let active = true
    void renderPage(1)
      .then((image) => {
        if (active) setCurrentImage(image)
      })
      .catch(() => {
        if (active) setError('첫 페이지를 펼치지 못했습니다. 새로고침해 주세요.')
      })
    return () => {
      active = false
    }
  }, [currentImage, pdf, renderPage])

  useEffect(() => {
    if (!pdf || !currentImage || pendingPage !== null) return
    if (page < pageCount) void renderPage(page + 1)
    if (page > 1) void renderPage(page - 1)
  }, [currentImage, page, pageCount, pdf, pendingPage, renderPage])

  const goToPage = useCallback(async (requestedPage: number) => {
    if (!pdf || !currentImage || pendingPage !== null || turnDirection !== null) return
    const targetPage = clampPage(requestedPage, pageCount)
    if (targetPage === page) return

    setPendingPage(targetPage)
    setLoadingLabel(`${targetPage}쪽으로 고양이가 달려가는 중이에요`)
    try {
      const image = await renderPage(targetPage)
      setNextImage(image)
      setTurnDirection(targetPage > page ? 'next' : 'previous')
      playPageTurn()
    } catch {
      setError(`${targetPage}쪽을 불러오지 못했습니다.`)
      setPendingPage(null)
    }
  }, [currentImage, page, pageCount, pdf, pendingPage, playPageTurn, renderPage, turnDirection])

  const finishTurn = useCallback(() => {
    if (pendingPage === null || !nextImage) return
    setPage(pendingPage)
    setCurrentImage(nextImage)
    setNextImage(null)
    setPendingPage(null)
    setTurnDirection(null)
  }, [nextImage, pendingPage])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, button, a, textarea, select')) return
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault()
        void goToPage(page + 1)
      }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault()
        void goToPage(page - 1)
      }
      if (event.key === 'Home') void goToPage(1)
      if (event.key === 'End') void goToPage(pageCount)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goToPage, page, pageCount])

  useEffect(() => {
    const updateFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', updateFullscreen)
    return () => document.removeEventListener('fullscreenchange', updateFullscreen)
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 2400)
    return () => window.clearTimeout(timer)
  }, [notice])

  const progress = useMemo(() => `${Math.round((page / pageCount) * 100)}%`, [page, pageCount])

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await viewerRef.current?.requestFullscreen()
  }

  async function shareBook() {
    const shareData = { title: document.title, url: window.location.href }
    try {
      if (navigator.share) await navigator.share(shareData)
      else {
        await navigator.clipboard.writeText(window.location.href)
        setNotice('책자 링크를 복사했어요')
      }
    } catch {
      // The native share sheet can be dismissed without showing an error.
    }
  }

  return (
    <main className="ebook" ref={viewerRef}>
      <a className="ebook-skip-link" href="#book-page">책자로 바로 가기</a>

      <div className="ebook-cat-pattern" aria-hidden="true">
        {PATTERN_CATS.map((source, index) => (
          <img alt="" key={`${source}-${index}`} src={source} />
        ))}
      </div>

      <header className="ebook-header">
        <div className="ebook-heading">
          <span className="ebook-kicker">TEACHER DEVELOPER HACKATHON · {pageCount} PAGES</span>
          <h1>교사 개발자 해커톤 <span>성장형</span></h1>
        </div>
        <div className="ebook-meta" aria-label="책자 정보">
          <span>서울행당초 · 홍성용</span>
          <i aria-hidden="true" />
          <span>PDF 원문</span>
        </div>
      </header>

      <section className="ebook-reading-room" aria-label="온라인 책자 뷰어">
        <div
          className="ebook-book-wrap"
          id="book-page"
          onPointerDown={(event) => { pointerStart.current = event.clientX }}
          onPointerUp={(event) => {
            if (pointerStart.current === null) return
            const distance = event.clientX - pointerStart.current
            pointerStart.current = null
            if (Math.abs(distance) < 54) return
            void goToPage(distance < 0 ? page + 1 : page - 1)
          }}
        >
          <div className="ebook-page-number" aria-live="polite">
            <strong>{String(page).padStart(2, '0')}</strong>
            <span>/ {String(pageCount).padStart(2, '0')}</span>
          </div>

          <div className="ebook-book" aria-busy={isBusy}>
            <div className="ebook-book-edge" aria-hidden="true" />
            {nextImage && (
              <img
                alt={`${pendingPage}쪽 강의 자료`}
                className="ebook-page-image ebook-page-image--under"
                src={nextImage}
              />
            )}
            {currentImage && (
              <img
                alt={`${page}쪽 강의 자료`}
                className={`ebook-page-image ${turnDirection ? `ebook-page-image--turn-${turnDirection}` : ''}`}
                onAnimationEnd={finishTurn}
                src={currentImage}
              />
            )}
            {!currentImage && <div className="ebook-page-placeholder" aria-hidden="true" />}

            {showLoader && (
              <div className="ebook-loader" role="status">
                <div className="ebook-loader-orbit" aria-hidden="true">
                  <span />
                  <img alt="" src="/assets/retro/retro-cat-recharging-break.png" />
                </div>
                <strong>{loadingLabel}</strong>
                <span>잠깐만 기다려 주세요</span>
              </div>
            )}
          </div>

          {error && (
            <div className="ebook-error" role="alert">
              <strong>앗, 책장을 펼치지 못했어요.</strong>
              <span>{error}</span>
              <button onClick={() => window.location.reload()} type="button">다시 시도</button>
            </div>
          )}
        </div>
      </section>

      <footer className="ebook-controls" aria-label="책자 조작 도구">
        <div className="ebook-progress" aria-hidden="true">
          <span style={{ width: progress }} />
        </div>
        <div className="ebook-control-row">
          <button
            aria-label="이전 페이지"
            className="ebook-page-button"
            disabled={page <= 1 || isBusy}
            onClick={() => void goToPage(page - 1)}
            type="button"
          >
            <span aria-hidden="true">←</span>
            <small>이전</small>
          </button>

          <label className="ebook-scrubber">
            <span className="sr-only">페이지 선택</span>
            <input
              aria-label={`페이지 선택, 현재 ${page}쪽`}
              disabled={!pdf || isBusy}
              max={pageCount}
              min="1"
              onChange={(event) => void goToPage(Number(event.target.value))}
              type="range"
              value={page}
            />
          </label>

          <button
            aria-label="다음 페이지"
            className="ebook-page-button ebook-page-button--next"
            disabled={page >= pageCount || isBusy}
            onClick={() => void goToPage(page + 1)}
            type="button"
          >
            <small>다음</small>
            <span aria-hidden="true">→</span>
          </button>

          <span className="ebook-control-divider" aria-hidden="true" />

          <button
            aria-pressed={soundEnabled}
            className="ebook-tool-button"
            onClick={() => setSoundEnabled((value) => !value)}
            title={soundEnabled ? '책 넘기는 소리 끄기' : '책 넘기는 소리 켜기'}
            type="button"
          >
            <span className="material-symbols-rounded" aria-hidden="true">{soundEnabled ? 'volume_up' : 'volume_off'}</span>
            <span className="sr-only">{soundEnabled ? '책 넘기는 소리 끄기' : '책 넘기는 소리 켜기'}</span>
          </button>
          <button className="ebook-tool-button" onClick={() => void toggleFullscreen()} title="전체 화면" type="button">
            <span className="material-symbols-rounded" aria-hidden="true">{isFullscreen ? 'fullscreen_exit' : 'fullscreen'}</span>
            <span className="sr-only">{isFullscreen ? '전체 화면 종료' : '전체 화면'}</span>
          </button>
          <button className="ebook-tool-button" onClick={() => void shareBook()} title="공유" type="button">
            <span className="material-symbols-rounded" aria-hidden="true">ios_share</span>
            <span className="sr-only">책자 공유</span>
          </button>
          <a className="ebook-tool-button" download href={PDF_URL} title="원본 PDF 다운로드">
            <span className="material-symbols-rounded" aria-hidden="true">download</span>
            <span className="sr-only">원본 PDF 다운로드</span>
          </a>
        </div>
        <p className="ebook-help">키보드 방향키 또는 화면을 좌우로 밀어 페이지를 넘길 수 있어요.</p>
      </footer>

      {notice && <div className="ebook-notice" role="status">{notice}</div>}
    </main>
  )
}
