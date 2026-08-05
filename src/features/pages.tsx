import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { Link, useLocation, useNavigate, useParams } from '../app/router'
import { usePlatform } from '../app/PlatformProvider'
import { createEmbedSnippet, createTextExport, type ExportFormat } from '../domain/exports'
import type {
  Answer,
  Participant,
  PublicProject,
  Submission,
  UpdateSynthesisInput,
} from '../domain/models'
import { downloadTextExport } from '../platform/download'
import { useAutosave } from '../platform/useAutosave'
import { usePersistentDraft } from '../platform/usePersistentDraft'
import { acceptAdminInviteWithGoogle, isAdminInviteEmailLink } from '../platform/firebase'
import { AdminLayout, ParticipantLayout } from '../layouts'
import {
  AutosaveStatus,
  Button,
  Card,
  CatIllustration,
  Chip,
  Dialog,
  Field,
  Icon,
  IconButton,
  MascotAction,
  MascotCue,
  Progress,
  SectionHeader,
  Select,
  StatCard,
  StatusChip,
  Switch,
  Textarea,
} from '../ui'
import { ReviewThreadsPanel } from './ReviewThreads'
import {
  EVENT_ID,
  PUBLIC_SLUG,
  OrganizerShell,
  ParticipantShell,
  PublicShell,
  announceResult,
  formatDate,
  formatTimer,
  useNotices,
} from './shared'

function OutcomeNote({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warm' }) {
  return (
    <div className={`notice${tone === 'warm' ? ' warm' : ''}`}>
      <Icon name={tone === 'warm' ? 'shield_lock' : 'info'} size="sm" />
      <div>{children}</div>
    </div>
  )
}

function ResultLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="result-link" to={to}>
      {children}
      <Icon name="arrow_forward" size="sm" />
    </Link>
  )
}

export function AdminInviteAcceptPage() {
  const { search } = useLocation()
  const { inviteId = '' } = useParams<{ inviteId: string }>()
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const eventId = new URLSearchParams(search).get('eventId') || EVENT_ID
  const validLink = isAdminInviteEmailLink()

  async function accept(event: FormEvent) {
    event.preventDefault()
    setStatus('loading')
    setMessage('')
    try {
      await acceptAdminInviteWithGoogle(inviteId, eventId)
      setStatus('done')
      setMessage('관리자 권한이 연결되었습니다. 운영 화면으로 이동합니다.')
      window.setTimeout(() => window.location.assign(`/admin/events/${eventId}/control`), 500)
    } catch (cause) {
      setStatus('error')
      setMessage(cause instanceof Error ? cause.message : '초대를 수락하지 못했습니다.')
    }
  }

  return (
    <PublicShell>
      <main className="public-main narrow-page">
        <Card padding="lg">
          <CatIllustration size="lg" variant="welcome" />
          <SectionHeader
            description="초대받은 동일한 Google 계정으로 로그인하면 행사 관리자 권한이 연결됩니다."
            eyebrow="ADMIN INVITE"
            title="관리자 초대 수락"
            titleAs="h1"
          />
          {validLink ? (
            <form className="form-grid" onSubmit={accept}>
              <Button disabled={status === 'loading'} leadingIcon="verified_user" size="lg" type="submit">
                {status === 'loading' ? '권한 확인 중' : 'Google로 초대 수락'}
              </Button>
            </form>
          ) : (
            <OutcomeNote tone="warm">초대 링크가 유효하지 않거나 만료되었습니다. 행사 Owner에게 새 초대를 요청해주세요.</OutcomeNote>
          )}
          {message ? <p aria-live="polite" className={status === 'error' ? 'field-error' : ''}>{message}</p> : null}
        </Card>
      </main>
    </PublicShell>
  )
}

function ParticipantIdentityGate({
  description,
  illustration,
  onCreate,
  title,
}: {
  description: string
  illustration: 'lobby' | 'submission'
  onCreate: () => void
  title: string
}) {
  return (
    <Card className="empty-state identity-gate" padding="lg">
      <CatIllustration size="lg" variant={illustration} />
      <Chip icon="person" tone="primary">개인 참여</Chip>
      <h1>{title}</h1>
      <p>{description}</p>
      <Button
        className="identity-gate__primary"
        leadingIcon="person_add"
        onClick={onCreate}
        size="lg"
      >
        새 닉네임 만들기
      </Button>
    </Card>
  )
}

export function LandingPage() {
  const navigate = useNavigate()
  const { state } = usePlatform()
  const [roomCode, setRoomCode] = useState(state.room.code)

  function join(event: FormEvent) {
    event.preventDefault()
    navigate(`/join/${roomCode.trim().toUpperCase() || state.room.code}`)
  }

  return (
    <PublicShell minimal>
      <main className="landing-gateway" id="main-content">
        <section aria-labelledby="gateway-title" className="gateway-panel">
          <div className="gateway-join">
            <span aria-hidden="true" className="gateway-icon"><Icon filled name="person_add" size="lg" /></span>
            <h1 id="gateway-title">참여자 입장</h1>
            <form className="gateway-join-form" onSubmit={join}>
              <label htmlFor="gateway-room-code">방 코드</label>
              <div className="gateway-join-row">
                <input
                  autoCapitalize="characters"
                  autoComplete="off"
                  id="gateway-room-code"
                  maxLength={8}
                  onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
                  value={roomCode}
                />
                <Button trailingIcon="arrow_forward" type="submit">입장</Button>
              </div>
            </form>
          </div>

          <nav aria-label="플랫폼 바로가기" className="gateway-actions">
            <Button className="gateway-action" leadingIcon="admin_panel_settings" onClick={() => navigate(`/admin/events/${EVENT_ID}/control`)} trailingIcon="arrow_forward" variant="text">
              주최자 로그인
            </Button>
            <Button className="gateway-action" leadingIcon="dashboard" onClick={() => navigate(`/dashboards/${PUBLIC_SLUG}`)} trailingIcon="arrow_forward" variant="text">
              수합 대시보드
            </Button>
            <Button className="gateway-action" leadingIcon="museum" onClick={() => navigate(`/exhibitions/${PUBLIC_SLUG}`)} trailingIcon="arrow_forward" variant="text">
              작품 전시
            </Button>
          </nav>
        </section>
      </main>
    </PublicShell>
  )
}

export function JoinPage() {
  const navigate = useNavigate()
  const { roomCode = 'VIBE26' } = useParams()
  const { joinParticipant, state } = usePlatform()
  const { notify, renderToasts } = useNotices()
  const [nickname, setNickname] = useState('')
  const [pin, setPin] = useState('')
  const [entryCode, setEntryCode] = useState('')
  const [error, setError] = useState('')
  const participantCount = state.participants.length ||
    state.room.participantCount ||
    state.publishedSnapshot?.data.metrics.participantCount ||
    0

  async function submit(event: FormEvent) {
    event.preventDefault()
    const result = await joinParticipant({ roomCode, nickname, pin, entryCode })
    if (result.ok) {
      notify(result.notice ?? '입장했어요.')
      navigate(`/events/${EVENT_ID}/live`)
      return
    }
    setError(result.error.message)
  }

  return (
    <PublicShell>
      <main className="page narrow" id="main-content">
        <div className="join-layout">
          <Card className="join-panel" padding="lg">
            <span className="eyebrow">ROOM · {roomCode.toUpperCase()}</span>
            <h1 className="join-title">다시 만날 수 있는 이름을 만들어주세요.</h1>
            <p className="muted join-description">닉네임과 숫자 4자리 PIN으로 처음 등록하거나 이전 작업을 이어서 엽니다.</p>
            <form className="form-grid" onSubmit={submit}>
              <Field label="방 코드" readOnly value={roomCode.toUpperCase()} />
              <Field
                autoComplete="nickname"
                error={error || undefined}
                label="닉네임"
                maxLength={16}
                onChange={(event) => { setNickname(event.target.value); setError('') }}
                placeholder="예: 밤하늘"
                required
                value={nickname}
              />
              <Field
                autoComplete="current-password"
                helpText="선행 0도 유지됩니다. 같은 닉네임으로 재입장할 때 필요해요."
                inputMode="numeric"
                label="PIN 4자리"
                maxLength={4}
                onChange={(event) => { setPin(event.target.value.replace(/\D/g, '').slice(0, 4)); setError('') }}
                pattern="\d{4}"
                placeholder="0000"
                required
                type="password"
                value={pin}
              />
              <Field
                autoComplete="one-time-code"
                helpText="처음 만드는 닉네임에만 필요합니다. 재입장이라면 비워두세요."
                inputMode="numeric"
                label="신규 입장 키 6자리"
                maxLength={6}
                onChange={(event) => { setEntryCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
                pattern="[0-9]{6}"
                placeholder="주최자에게 확인"
                type="password"
                value={entryCode}
              />
              <Button fullWidth size="lg" trailingIcon="arrow_forward" type="submit">입장하고 시작하기</Button>
            </form>
          </Card>
          <div className="join-art">
            <CatIllustration loading="eager" size="hero" variant="lobby" />
            <div className="join-art-copy">
              <StatusChip label={`${participantCount} / ${state.room.capacity}명 입장`} status="live" />
              <h2>같은 방, 같은 흐름</h2>
              <p>주최자가 다음 페이지로 이동하면 이 화면도 함께 이동합니다.</p>
            </div>
          </div>
        </div>
        <OutcomeNote>
          <strong>PIN 보관 안내</strong><br />PIN은 다시 입장하거나 주최자에게 참여 지원을 받을 때 사용됩니다. 잊지 않도록 안전한 곳에 보관해주세요.
        </OutcomeNote>
      </main>
      {renderToasts()}
    </PublicShell>
  )
}

function answerAuthor(answer: Answer, participants: Participant[]): Participant | undefined {
  return participants.find((participant) => participant.id === answer.participantId)
}

export function ParticipantLivePage() {
  const navigate = useNavigate()
  const {
    currentParticipant,
    currentSlide,
    dispatchAsync,
    savePrivateDraft,
    state,
    timerView,
  } = usePlatform()
  const { notify, renderToasts } = useNotices()
  const answerDraftKey = `vibecoding.answer-drafts.${currentParticipant?.id ?? 'guest'}`
  const [answerDrafts, setAnswerDrafts] = usePersistentDraft<Record<string, string>>(
    answerDraftKey,
    {},
  )
  const [answerDraftBases, setAnswerDraftBases] = usePersistentDraft<Record<string, string>>(
    `${answerDraftKey}.base-updated-at`,
    {},
  )
  const [answerDraftRevisionBases, setAnswerDraftRevisionBases] = usePersistentDraft<Record<string, number>>(
    `${answerDraftKey}.base-revision`,
    {},
  )
  const [answerRebaseVersion, setAnswerRebaseVersion] = useState(0)
  const savedAnswerDraftsRef = useRef<Record<string, string>>({})
  const [commentTarget, setCommentTarget] = useState<string | null>(null)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [commentDrafts, setCommentDrafts] = usePersistentDraft<Record<string, string>>(
    `vibecoding.comment-drafts.${currentParticipant?.id ?? 'guest'}`,
    {},
  )
  const [commentEditDrafts, setCommentEditDrafts] = usePersistentDraft<Record<string, string>>(
    `vibecoding.comment-edit-drafts.${currentParticipant?.id ?? 'guest'}`,
    {},
  )
  const revealed = Boolean(state.live.answersRevealedBySlide[currentSlide.id])
  const commentsEnabled = Boolean(state.live.commentsEnabledBySlide[currentSlide.id])
  const stageAnswers = state.answers.filter(
    (answer) => answer.slideId === currentSlide.id && answer.status === 'submitted',
  )
  const ownAnswer = currentParticipant
    ? state.answers.find(
        (answer) => answer.participantId === currentParticipant.id && answer.slideId === currentSlide.id,
      )
    : undefined
  const submittedOwnAnswer = currentParticipant
    ? state.answers.find(
        (answer) => answer.participantId === currentParticipant.id &&
          answer.slideId === currentSlide.id &&
          answer.status === 'submitted',
      )
    : undefined
  const answerText = answerDrafts[currentSlide.id] ?? ownAnswer?.content ?? ''
  const answerDraftConflict = currentSlide.id in answerDrafts
    && answerDrafts[currentSlide.id] !== (ownAnswer?.content ?? '')
    && answerDraftRevisionBases[currentSlide.id] !== (ownAnswer?.draftRevision ?? 0)
  const answerDraftHasConflict = Object.entries(answerDrafts).some(([slideId, content]) => {
    const remote = state.answers.find((answer) => (
      answer.participantId === currentParticipant?.id && answer.slideId === slideId
    ))
    return content !== (remote?.content ?? '')
      && answerDraftRevisionBases[slideId] !== (remote?.draftRevision ?? 0)
  })
  const commentText = commentTarget ? (commentDrafts[commentTarget] ?? '') : ''
  const editingComment = state.comments.find((comment) => comment.id === editingCommentId)
  const editingCommentText = editingCommentId
    ? (commentEditDrafts[editingCommentId] ?? editingComment?.body ?? '')
    : ''
  const answerAutosave = useAutosave({
    enabled: Boolean(currentParticipant && !answerDraftHasConflict),
    // Server acknowledgements advance the stored base revision without being
    // new edits. Keep them out of the fingerprint so the UI does not start a
    // redundant debounce cycle after a successful save. An explicit conflict
    // rebase increments answerRebaseVersion to request the intended retry.
    fingerprint: JSON.stringify([answerDrafts, answerRebaseVersion]),
    saveOnMount: Object.entries(answerDrafts).some(([slideId, content]) => {
      const remote = state.answers.find((answer) => (
        answer.participantId === currentParticipant?.id && answer.slideId === slideId
      ))
      return content !== (remote?.content ?? '')
        && answerDraftBases[slideId] === (remote?.updatedAt ?? '')
        && answerDraftRevisionBases[slideId] === (remote?.draftRevision ?? 0)
    }),
    save: async () => {
      if (!currentParticipant) return false
      const entries = Object.entries(answerDrafts).filter(
        ([slideId, content]) => {
          if (savedAnswerDraftsRef.current[slideId] === content) return false
          const remote = state.answers.find((answer) => (
            answer.participantId === currentParticipant.id && answer.slideId === slideId
          ))
          return content !== (remote?.content ?? '')
            && answerDraftBases[slideId] === (remote?.updatedAt ?? '')
            && answerDraftRevisionBases[slideId] === (remote?.draftRevision ?? 0)
        },
      )
      const results = await Promise.all(entries.map(([slideId, content]) => {
        const remote = state.answers.find((answer) => (
          answer.participantId === currentParticipant.id && answer.slideId === slideId
        ))
        return dispatchAsync({
          type: 'SAVE_ANSWER',
          input: {
            baseRevision: answerDraftRevisionBases[slideId] ?? remote?.draftRevision ?? 0,
            participantId: currentParticipant.id,
            slideId,
            content,
            submit: false,
          },
        })
      }))
      entries.forEach(([slideId, content], index) => {
        if (results[index].ok) {
          savedAnswerDraftsRef.current[slideId] = content
        }
      })
      return results.every((result) => result.ok)
    },
  })
  const commentAutosave = useAutosave({
    enabled: Boolean(currentParticipant && commentTarget && commentText),
    fingerprint: `${commentTarget ?? ''}:${commentText}`,
    save: () => commentTarget
      ? savePrivateDraft('comment', commentTarget, { body: commentText })
      : false,
  })
  const commentEditAutosave = useAutosave({
    enabled: Boolean(currentParticipant && editingCommentId && editingCommentText),
    fingerprint: `${editingCommentId ?? ''}:${editingCommentText}`,
    save: () => editingCommentId
      ? savePrivateDraft('comment-edit', editingCommentId, { body: editingCommentText })
      : false,
  })

  useEffect(() => {
    setAnswerDraftBases((current) => {
      let changed = false
      const next = { ...current }
      for (const [slideId, content] of Object.entries(answerDrafts)) {
        const remote = state.answers.find((answer) => (
          answer.participantId === currentParticipant?.id && answer.slideId === slideId
        ))
        if (remote?.content === content && next[slideId] !== remote.updatedAt) {
          next[slideId] = remote.updatedAt
          changed = true
        }
      }
      return changed ? next : current
    })
    setAnswerDraftRevisionBases((current) => {
      let changed = false
      const next = { ...current }
      for (const [slideId, content] of Object.entries(answerDrafts)) {
        const remote = state.answers.find((answer) => (
          answer.participantId === currentParticipant?.id && answer.slideId === slideId
        ))
        const revision = remote?.draftRevision ?? 0
        if (remote?.content === content && next[slideId] !== revision) {
          next[slideId] = revision
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [
    answerDrafts,
    currentParticipant?.id,
    setAnswerDraftBases,
    setAnswerDraftRevisionBases,
    state.answers,
  ])

  if (!currentParticipant) {
    return (
      <ParticipantShell>
        <main className="page narrow" id="main-content">
          <ParticipantIdentityGate
            description="각자 만든 닉네임과 PIN으로 답변과 개인 작품을 안전하게 이어갑니다."
            illustration="lobby"
            onCreate={() => navigate(`/join/${state.room.code}`)}
            title="나만의 참여자 이름으로 시작하세요."
          />
        </main>
      </ParticipantShell>
    )
  }
  const participant = currentParticipant

  async function saveAnswer(submit = true) {
    const ok = announceResult(
      await dispatchAsync({
        type: 'SAVE_ANSWER',
        input: {
          baseRevision: answerDraftRevisionBases[currentSlide.id]
            ?? ownAnswer?.draftRevision
            ?? 0,
          participantId: participant.id,
          slideId: currentSlide.id,
          content: answerText,
          submit,
        },
      }),
      notify,
    )
    if (ok) {
      savedAnswerDraftsRef.current[currentSlide.id] = answerText.trim()
      answerAutosave.markSaved()
      setAnswerDrafts((current) => {
        if (!(currentSlide.id in current)) return current
        const next = { ...current }
        delete next[currentSlide.id]
        return next
      })
    }
  }

  async function addComment(event: FormEvent) {
    event.preventDefault()
    if (!commentTarget) return
    const ok = announceResult(
      await dispatchAsync({
        type: 'ADD_COMMENT',
        input: { participantId: participant.id, answerId: commentTarget, body: commentText },
      }),
      notify,
    )
    if (ok) {
      setCommentDrafts((current) => {
        const next = { ...current }
        delete next[commentTarget]
        return next
      })
      setCommentTarget(null)
    }
  }

  async function saveEditedComment() {
    if (!editingCommentId) return
    const ok = announceResult(
      await dispatchAsync({
        type: 'UPDATE_COMMENT',
        input: { participantId: participant.id, commentId: editingCommentId, body: editingCommentText },
      }),
      notify,
    )
    if (ok) {
      setCommentEditDrafts((current) => {
        const next = { ...current }
        delete next[editingCommentId]
        return next
      })
      setEditingCommentId(null)
    }
  }

  return (
    <ParticipantShell>
      <ParticipantLayout
        aside={
          <Card className="participant-side-card" padding="md" tone="subtle">
            <CatIllustration decorative size="md" variant={revealed ? 'comment' : timerView.status === 'complete' ? 'deadline' : 'focus'} />
            <strong>{revealed ? '서로의 생각을 읽는 시간' : '지금은 나의 답에 집중'}</strong>
            <p>{revealed ? '공개된 답변에 댓글로 맥락을 더해보세요.' : '제출 전까지 다른 사람의 답변은 보이지 않아요.'}</p>
          </Card>
        }
        description={currentSlide.helper}
        eyebrow={currentSlide.eyebrow}
        progress={{ current: currentSlide.order, total: state.slides.length, label: `${currentSlide.order} / ${state.slides.length} 단계 · 주최자와 동기화` }}
        title={currentSlide.title}
      >
        <section aria-live="polite" className="participant-stage">
          <header className="participant-stage-head">
            <span><span className="live-dot" /> LIVE QUESTION</span>
            <strong>{formatTimer(timerView.remainingSec)}</strong>
          </header>
          <div className="participant-stage-body">
            <p className="stage-prompt">{currentSlide.prompt}</p>
            {!revealed ? (
              <div className="stack">
                <Textarea
                  disabled={timerView.status === 'complete'}
                  helpText={<AutosaveStatus phase={answerAutosave.phase} savedAt={answerAutosave.savedAt} />}
                  label="나의 개인 답변"
                  maxLength={1200}
                  onChange={(event) => {
                    if (!(currentSlide.id in answerDrafts)) {
                      setAnswerDraftBases((current) => ({
                        ...current,
                        [currentSlide.id]: ownAnswer?.updatedAt ?? '',
                      }))
                      setAnswerDraftRevisionBases((current) => ({
                        ...current,
                        [currentSlide.id]: ownAnswer?.draftRevision ?? 0,
                      }))
                    }
                    setAnswerDrafts((current) => ({
                      ...current,
                      [currentSlide.id]: event.target.value,
                    }))
                  }}
                  placeholder="관찰한 장면과 맥락을 구체적으로 적어보세요."
                  rows={7}
                  showCount
                  value={answerText}
                />
                {answerDraftConflict ? (
                  <OutcomeNote tone="warm">
                    이 기기의 초안보다 Firebase에 더 최신 답변이 있어 자동저장을 멈췄습니다.
                    <Button
                      onClick={() => {
                        // This content may already have been acknowledged at an
                        // older revision. A deliberate rebase must retry it
                        // against the newly accepted server revision instead of
                        // treating the matching text as already persisted.
                        delete savedAnswerDraftsRef.current[currentSlide.id]
                        setAnswerDraftBases((current) => ({
                          ...current,
                          [currentSlide.id]: ownAnswer?.updatedAt ?? '',
                        }))
                        setAnswerDraftRevisionBases((current) => ({
                          ...current,
                          [currentSlide.id]: ownAnswer?.draftRevision ?? 0,
                        }))
                        setAnswerRebaseVersion((current) => current + 1)
                      }}
                      size="sm"
                      variant="text"
                    >내 초안으로 계속 편집</Button>
                  </OutcomeNote>
                ) : null}
                <div className="split mobile-stack">
                  <span className="chip-row">
                    <Chip icon="lock" tone="info">공개 전 비공개</Chip>
                    {ownAnswer?.status === 'submitted' ? <Chip icon="check_circle" tone="success">제출됨</Chip> : null}
                  </span>
                  <MascotAction compactOnly label="입력 내용은 자동 저장하고 있어요" variant="autosave">
                    <Button disabled={answerDraftConflict || !answerText.trim() || timerView.status === 'complete'} onClick={() => { void saveAnswer(false) }} variant="text">임시 저장</Button>
                    <Button disabled={answerDraftConflict || !answerText.trim() || timerView.status === 'complete'} leadingIcon="send" onClick={() => { void saveAnswer(true) }}>개인 답변 제출</Button>
                  </MascotAction>
                </div>
              </div>
            ) : (
              <div className="reveal-intro">
                <Chip icon="visibility" tone="success">답변 공개됨</Chip>
                <h2>{stageAnswers.length}개의 서로 다른 시선</h2>
                <p>주최자가 이 단계의 답변을 공개했습니다. 댓글은 작성자의 닉네임과 함께 남습니다.</p>
              </div>
            )}
          </div>
        </section>

        {submittedOwnAnswer ? (
          <ReviewThreadsPanel
            fieldOptions={[{ label: '단계 답변', value: '단계 답변' }]}
            mode="participant"
            participantId={participant.id}
            quote={submittedOwnAnswer.content}
            targetId={submittedOwnAnswer.id}
            targetType="answer"
            title="주최자 피드백"
          />
        ) : null}

        {revealed ? (
          <section className="stack" aria-label="공개된 답변">
            {stageAnswers.map((answer) => {
              const author = answerAuthor(answer, state.participants)
              const answerComments = state.comments.filter((comment) => comment.answerId === answer.id)
              return (
                <article className={`answer-card${answer.participantId === currentParticipant.id ? ' highlighted' : ''}`} key={answer.id}>
                  <div className="answer-meta">
                    <span className="chip-row">
                      <span className="avatar">{author?.nickname.slice(0, 1) ?? '?'}</span>
                      <strong>{author?.nickname ?? '알 수 없음'}</strong>
                      {answer.participantId === currentParticipant.id ? <Chip tone="primary">내 답변</Chip> : null}
                    </span>
                    <span>{answerComments.length}개 댓글</span>
                  </div>
                  <p>{answer.content}</p>
                  {answerComments.length ? (
                    <div className="comment-list">
                      {answerComments.map((comment) => {
                        const commentAuthor = state.participants.find((participant) => participant.id === comment.participantId)
                        const mine = comment.participantId === currentParticipant.id
                        return (
                          <div className="comment" key={comment.id}>
                            <div className="comment-meta">
                              <strong>{commentAuthor?.nickname ?? '참가자'}</strong>
                              {mine ? (
                                <div className="inline-actions">
                                  <button
                                    className="text-action"
                                    onClick={() => {
                                      setCommentEditDrafts((current) => ({
                                        ...current,
                                        [comment.id]: current[comment.id] ?? comment.body,
                                      }))
                                      setEditingCommentId(comment.id)
                                    }}
                                    type="button"
                                  >수정</button>
                                  <button
                                    className="text-action danger-text"
                                    onClick={() => {
                                      void dispatchAsync({ type: 'DELETE_COMMENT', input: { participantId: currentParticipant.id, commentId: comment.id } })
                                        .then((result) => announceResult(result, notify))
                                    }}
                                    type="button"
                                  >삭제</button>
                                </div>
                              ) : null}
                            </div>
                            <p>{comment.body}</p>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                  <Button
                    disabled={!commentsEnabled}
                    leadingIcon="add_comment"
                    onClick={() => setCommentTarget(answer.id)}
                    size="sm"
                    variant="text"
                  >
                    {commentsEnabled ? '댓글 달기' : '댓글 잠김'}
                  </Button>
                  {commentTarget === answer.id ? (
                    <form className="comment-form" onSubmit={addComment}>
                      <Field
                        autoFocus
                        label="댓글"
                        maxLength={500}
                        helpText="등록 전 작성 내용은 이 기기와 Firebase에 자동 저장됩니다."
                        onChange={(event) => setCommentDrafts((current) => ({
                          ...current,
                          [answer.id]: event.target.value,
                        }))}
                        placeholder="맥락을 더하는 댓글을 남겨주세요."
                        value={commentText}
                      />
                      <div className="button-row">
                        <AutosaveStatus phase={commentAutosave.phase} savedAt={commentAutosave.savedAt} />
                        <Button onClick={() => setCommentTarget(null)} size="sm" variant="text">취소</Button>
                        <Button disabled={!commentText.trim()} size="sm" type="submit">등록</Button>
                      </div>
                    </form>
                  ) : null}
                </article>
              )
            })}
            {!commentsEnabled ? <OutcomeNote>주최자가 답변은 공개했지만 댓글은 아직 열지 않았습니다.</OutcomeNote> : null}
          </section>
        ) : (
          <div className="private-state">
            <CatIllustration decorative size="sm" variant="ideation" />
            <div><strong>다른 답변은 아직 비공개입니다.</strong><br />주최자가 공개하면 이 자리에 함께 나타납니다.</div>
          </div>
        )}
      </ParticipantLayout>
      <Dialog
        actions={(
          <>
            <Button onClick={() => setEditingCommentId(null)} variant="text">취소</Button>
            <Button disabled={!editingCommentText.trim()} leadingIcon="save" onClick={() => { void saveEditedComment() }}>수정 저장</Button>
          </>
        )}
        description="작성 중인 수정 내용은 이 기기와 Firebase에 자동 저장됩니다."
        onClose={() => setEditingCommentId(null)}
        open={Boolean(editingComment)}
        size="sm"
        title="댓글 수정"
      >
        <Textarea
          label="댓글"
          maxLength={500}
          onChange={(event) => {
            if (!editingCommentId) return
            setCommentEditDrafts((current) => ({ ...current, [editingCommentId]: event.target.value }))
          }}
          rows={4}
          value={editingCommentText}
        />
        <AutosaveStatus phase={commentEditAutosave.phase} savedAt={commentEditAutosave.savedAt} />
      </Dialog>
      {renderToasts()}
    </ParticipantShell>
  )
}

export function SubmissionPage() {
  const navigate = useNavigate()
  const { currentParticipant, dispatchAsync, state } = usePlatform()
  const { notify, renderToasts } = useNotices()
  const existingDraft = state.submissions.find(
    (submission) => submission.participantId === currentParticipant?.id && submission.status === 'draft',
  )
  const submittedExisting = state.submissions.find(
    (submission) => submission.participantId === currentParticipant?.id && submission.status === 'submitted',
  )
  const existing = existingDraft ?? submittedExisting
  const projectFallback = {
    title: existing?.title ?? '',
    pitch: existing?.pitch ?? '',
    description: existing?.description ?? '',
    demoUrl: existing?.demoUrl ?? '',
    githubUrl: existing?.githubUrl ?? '',
    tags: existing?.tags.join(', ') ?? '',
    retrospective: existing?.retrospective ?? '',
  }
  const projectDraftKey = `vibecoding.project-draft.${currentParticipant?.id ?? 'guest'}`
  const hasStoredProjectDraft = typeof window !== 'undefined'
    && window.sessionStorage.getItem(projectDraftKey) !== null
  const [form, setForm] = usePersistentDraft(
    projectDraftKey,
    projectFallback,
  )
  const [projectDraftBase, setProjectDraftBase] = usePersistentDraft(
    `${projectDraftKey}.base-updated-at`,
    hasStoredProjectDraft ? '__untracked__' : (existing?.updatedAt ?? ''),
  )
  const [projectDraftRevisionBase, setProjectDraftRevisionBase] = usePersistentDraft(
    `${projectDraftKey}.base-revision`,
    hasStoredProjectDraft ? -1 : (existingDraft?.draftRevision ?? 0),
  )
  const projectDirty = JSON.stringify(form) !== JSON.stringify(projectFallback)
  const projectConflict = projectDirty && (
    projectDraftBase !== (existing?.updatedAt ?? '')
    || projectDraftRevisionBase !== (existingDraft?.draftRevision ?? 0)
  )

  const projectAutosave = useAutosave({
    enabled: Boolean(currentParticipant && projectDirty && !projectConflict),
    fingerprint: JSON.stringify([form, projectDraftRevisionBase]),
    saveOnMount: Boolean(currentParticipant && projectDirty && !projectConflict),
    save: async () => {
      if (!currentParticipant) return false
      return (await dispatchAsync<Submission>({
        type: 'SUBMIT_PROJECT',
        input: {
          baseRevision: projectDraftRevisionBase,
          participantId: currentParticipant.id,
          ...form,
          tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
          coverImage: '/assets/illustrations/cat-submission.webp',
          submit: false,
        },
      })).ok
    },
  })

  function update(name: keyof typeof form, value: string) {
    if (!projectDirty) {
      setProjectDraftBase(existing?.updatedAt ?? '')
      setProjectDraftRevisionBase(existingDraft?.draftRevision ?? 0)
    }
    setForm((current) => ({ ...current, [name]: value }))
  }

  useEffect(() => {
    if (!projectDirty) {
      if (projectDraftBase !== (existing?.updatedAt ?? '')) {
        setProjectDraftBase(existing?.updatedAt ?? '')
      }
      if (projectDraftRevisionBase !== (existingDraft?.draftRevision ?? 0)) {
        setProjectDraftRevisionBase(existingDraft?.draftRevision ?? 0)
      }
    }
  }, [
    existing?.updatedAt,
    existingDraft?.draftRevision,
    projectDirty,
    projectDraftBase,
    projectDraftRevisionBase,
    setProjectDraftBase,
    setProjectDraftRevisionBase,
  ])

  async function save(submit: boolean) {
    if (!currentParticipant) return
    const ok = announceResult(
      await dispatchAsync<Submission>({
        type: 'SUBMIT_PROJECT',
        input: {
          baseRevision: projectDraftRevisionBase,
          participantId: currentParticipant.id,
          ...form,
          tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
          coverImage: '/assets/illustrations/cat-submission.webp',
          submit,
        },
      }),
      notify,
    )
    if (ok) projectAutosave.markSaved()
    if (ok && submit) notify('제출을 완료했어요. 주최자가 새 공개 리비전을 발행하면 전시에 반영됩니다.', 'info')
  }

  if (!currentParticipant) {
    return (
      <ParticipantShell>
        <main className="page narrow" id="main-content">
          <ParticipantIdentityGate
            description="각자의 작품을 분리해 보관하기 위해 먼저 나만의 닉네임과 PIN을 만들어주세요."
            illustration="submission"
            onCreate={() => navigate(`/join/${state.room.code}`)}
            title="개인 작품을 위한 이름을 만들어주세요."
          />
        </main>
        {renderToasts()}
      </ParticipantShell>
    )
  }

  return (
    <ParticipantShell>
      <ParticipantLayout
        aside={
          <Card className="submission-preview" padding="lg" tone="warm">
            <CatIllustration decorative size="lg" variant={existing?.status === 'submitted' ? 'celebrate' : 'autosave'} />
            <Chip icon="person" tone="warning">개인 제출</Chip>
            <h3>{form.title || '나의 작품 제목'}</h3>
            <p>{form.pitch || '한 줄 소개가 이곳에 표시됩니다.'}</p>
            <div className="chip-row">{form.tags.split(',').filter(Boolean).slice(0, 3).map((tag) => <Chip key={tag}>{tag.trim()}</Chip>)}</div>
          </Card>
        }
        description="과정에서 남긴 생각을 한 사람의 작품 카드와 README로 이어주세요. 팀 제출은 지원하지 않습니다."
        eyebrow="FINAL · INDIVIDUAL SUBMISSION"
        title="나의 최종 작품"
      >
        <OutcomeNote><strong>개인 제출 원칙</strong><br />참여자당 한 작품만 저장됩니다. 다시 제출하면 나의 기존 작품이 갱신됩니다.</OutcomeNote>
        {projectConflict ? (
          <OutcomeNote tone="warm">
            이 기기의 초안보다 Firebase에 더 최신 작품 정보가 있어 자동저장을 멈췄습니다.
            <Button
              onClick={() => {
                setProjectDraftBase(existing?.updatedAt ?? '')
                setProjectDraftRevisionBase(existingDraft?.draftRevision ?? 0)
              }}
              size="sm"
              variant="text"
            >내 초안으로 계속 편집</Button>
          </OutcomeNote>
        ) : null}
        <Card padding="lg">
          <div className="form-grid">
            <Field label="작품명" maxLength={60} onChange={(event) => update('title', event.target.value)} placeholder="작품명을 입력하세요" required value={form.title} />
            <Field label="한 줄 소개" maxLength={120} onChange={(event) => update('pitch', event.target.value)} placeholder="무엇을 누구에게 어떻게 바꾸는지 한 문장으로" required value={form.pitch} />
            <Textarea label="상세 설명" maxLength={1500} onChange={(event) => update('description', event.target.value)} required rows={6} showCount value={form.description} />
            <div className="grid two">
              <Field label="실행 URL" onChange={(event) => update('demoUrl', event.target.value)} placeholder="https://" type="url" value={form.demoUrl} />
              <Field label="GitHub URL" onChange={(event) => update('githubUrl', event.target.value)} placeholder="https://github.com/" type="url" value={form.githubUrl} />
            </div>
            <Field helpText="쉼표로 구분하며 최대 6개까지 전시에 표시됩니다." label="기술·주제 태그" onChange={(event) => update('tags', event.target.value)} placeholder="React, Firebase, 교육" value={form.tags} />
            <Textarea label="제작 회고" maxLength={1200} onChange={(event) => update('retrospective', event.target.value)} required rows={5} showCount value={form.retrospective} />
            <div className="split mobile-stack">
              <AutosaveStatus phase={projectAutosave.phase} savedAt={projectAutosave.savedAt} />
              <MascotAction compactOnly label="작품 초안을 자동 저장하고 있어요" variant="autosave">
                <Button disabled={projectConflict} onClick={() => { void save(false) }} variant="text">임시 저장</Button>
                <Button disabled={projectConflict} leadingIcon="rocket_launch" onClick={() => { void save(true) }}>개인 작품 제출</Button>
              </MascotAction>
            </div>
          </div>
        </Card>
        {existing ? (
          <ReviewThreadsPanel
            fieldOptions={[
              { label: '작품명', value: '작품명' },
              { label: '한 줄 소개', value: '한 줄 소개' },
              { label: '상세 설명', value: '상세 설명' },
              { label: '제작 회고', value: '제작 회고' },
            ]}
            mode="participant"
            participantId={currentParticipant.id}
            quote={existing.description}
            targetId={currentParticipant.id}
            targetType="submission"
            title="작품 검토 피드백"
          />
        ) : null}
      </ParticipantLayout>
      {renderToasts()}
    </ParticipantShell>
  )
}

export function OrganizerControlPage() {
  const { currentSlide, dispatchAsync, state, timerView } = usePlatform()
  const { notify, renderToasts } = useNotices()
  const [reviewAnswerId, setReviewAnswerId] = useState<string | null>(null)
  const revealed = Boolean(state.live.answersRevealedBySlide[currentSlide.id])
  const commentsEnabled = Boolean(state.live.commentsEnabledBySlide[currentSlide.id])
  const recentlyActiveCount = state.participants.filter(
    (participant) => Date.now() - Date.parse(participant.lastSeenAt) < 15 * 60_000,
  ).length
  const stageAnswerCount = state.answers.filter((answer) => answer.slideId === currentSlide.id && answer.status === 'submitted').length
  const stageAnswers = state.answers.filter((answer) => answer.slideId === currentSlide.id && answer.status === 'submitted')
  const submittedCount = state.submissions.filter((submission) => submission.status === 'submitted').length
  const reviewAnswer = stageAnswers.find((answer) => answer.id === reviewAnswerId)

  useEffect(() => {
    setReviewAnswerId(null)
  }, [currentSlide.id])

  function run(command: Parameters<typeof dispatchAsync>[0]) {
    void dispatchAsync(command).then((result) => announceResult(result, notify))
  }

  function move(offset: number) {
    const next = Math.min(Math.max(state.live.activeSlideIndex + offset, 0), state.slides.length - 1)
    run({ type: 'SET_ACTIVE_SLIDE', slideIndex: next })
  }

  return (
    <OrganizerShell>
      <AdminLayout
        actions={<StatusChip label="실시간 진행 동기화" status="live" />}
        description="페이지, 타이머, 답변 공개 상태를 한곳에서 제어하고 모든 참여자의 화면에 반영합니다."
        eyebrow={`LIVE CONTROL · REVISION ${state.revision}`}
        title="지금 모두가 보고 있는 장면"
      >
        <div className="grid four">
          <StatCard detail={`정원 ${state.room.capacity}명`} icon="groups" label="입장 참여자" trend={`${recentlyActiveCount}명 최근 활동`} value={`${state.participants.length}명`} />
          <StatCard detail="현재 단계" icon="edit_note" label="개인 답변" trend={`${stageAnswerCount}개 수합`} trendTone="primary" value={`${Math.round((stageAnswerCount / state.participants.length) * 100)}%`} />
          <StatCard detail="공개 후 댓글" icon="forum" label="댓글" trend={commentsEnabled ? '작성 열림' : '잠김'} trendTone={commentsEnabled ? 'success' : 'neutral'} value={`${state.comments.length}개`} />
          <StatCard detail="모두 개인 작품" icon="rocket_launch" label="최종 제출" trend={`${state.participants.length - submittedCount}명 남음`} trendTone="warning" value={`${submittedCount}개`} />
        </div>
        <OutcomeNote><strong>입장 마감 안내</strong><br />참여자 입장을 확인한 뒤 첫 타이머를 시작하거나 재개하면 새 닉네임 등록은 마감됩니다. 기존 참여자의 PIN 재입장은 계속 가능합니다.</OutcomeNote>

        <div className="live-console">
          <section className="stage-card" aria-live="polite">
            <div className="stage-kicker">
              <span>{currentSlide.eyebrow}</span>
              <Chip tone={revealed ? 'success' : 'info'}>{revealed ? '답변 공개됨' : '개인 작성 중'}</Chip>
            </div>
            <h2>{currentSlide.title}</h2>
            <p>{currentSlide.prompt}</p>
            <img alt="" className="stage-cat" src={currentSlide.illustration} />
          </section>

          <aside className="timer-panel">
            <div className="timer-display">
              <span className="small-text">남은 시간 · {timerView.status === 'running' ? '진행 중' : timerView.status === 'paused' ? '일시정지' : timerView.status === 'complete' ? '종료' : '준비'}</span>
              <div className="timer-value">{formatTimer(timerView.remainingSec)}</div>
              <Progress max={state.live.timer.durationSec} tone="warning" value={timerView.remainingSec} />
            </div>
            <Card padding="md">
              <div className="control-pad">
                <IconButton disabled={state.live.activeSlideIndex === 0} icon="arrow_back" label="이전 슬라이드" onClick={() => move(-1)} variant="outlined" />
                {timerView.status === 'running' ? (
                  <Button leadingIcon="pause" onClick={() => run({ type: 'PAUSE_TIMER' })}>일시정지</Button>
                ) : (
                  <Button leadingIcon="play_arrow" onClick={() => run({ type: timerView.status === 'paused' ? 'RESUME_TIMER' : 'START_TIMER' })}>시작</Button>
                )}
                <IconButton disabled={state.live.activeSlideIndex === state.slides.length - 1} icon="arrow_forward" label="다음 슬라이드" onClick={() => move(1)} variant="outlined" />
              </div>
              <Button fullWidth leadingIcon="restart_alt" onClick={() => run({ type: 'RESET_TIMER' })} size="sm" variant="text">타이머 초기화</Button>
            </Card>
            <Card padding="md">
              <div className="split">
                <div><strong>답변 공개</strong><p className="small-text muted">현재 단계 {stageAnswerCount}개</p></div>
                <Switch
                  checked={revealed}
                  label="현재 단계 답변 공개"
                  onChange={(checked) => run({ type: 'SET_ANSWERS_REVEALED', slideId: currentSlide.id, revealed: checked })}
                />
              </div>
              <div className="divider" />
              <div className="split">
                <div><strong>댓글 작성</strong><p className="small-text muted">답변 공개 후 열 수 있어요</p></div>
                <Switch
                  checked={commentsEnabled}
                  disabled={!revealed}
                  label="현재 단계 댓글 작성"
                  onChange={(checked) => run({ type: 'SET_COMMENTS_ENABLED', slideId: currentSlide.id, enabled: checked })}
                />
              </div>
            </Card>
          </aside>
        </div>

        <Card padding="lg">
          <SectionHeader description="항목을 선택하면 모든 참여자 화면이 같은 단계로 이동합니다." eyebrow="DECK · 4 STEPS" title="진행 슬라이드" />
          <div className="slide-list">
            {state.slides.map((slide, index) => {
              const count = state.answers.filter((answer) => answer.slideId === slide.id && answer.status === 'submitted').length
              const active = index === state.live.activeSlideIndex
              return (
                <button className={`slide-item${active ? ' active' : ''}`} key={slide.id} onClick={() => run({ type: 'SET_ACTIVE_SLIDE', slideIndex: index })} type="button">
                  <span className="slide-index">{String(slide.order).padStart(2, '0')}</span>
                  <span className="list-main"><span className="list-title">{slide.title}</span><span className="list-subtitle">{Math.round(slide.durationSec / 60)}분 · 답변 {count}개</span></span>
                  <Chip tone={state.live.answersRevealedBySlide[slide.id] ? 'success' : 'neutral'}>{state.live.answersRevealedBySlide[slide.id] ? '공개' : '비공개'}</Chip>
                  <Icon name={active ? 'sensors' : 'chevron_right'} />
                </button>
              )
            })}
          </div>
        </Card>

        <Card padding="lg">
          <SectionHeader
            description="공개 토론 댓글과 분리된 비공개 검토 의견을 참여자에게 직접 남길 수 있습니다."
            eyebrow="MATERIAL 3 · INLINE REVIEW"
            title="현재 단계 답변 검토"
            titleAs="h2"
          />
          <div className="stack compact organizer-review-list">
            {stageAnswers.map((answer) => {
              const participant = answerAuthor(answer, state.participants)
              const threadCount = state.reviewThreads.filter((thread) => thread.targetType === 'answer' && thread.targetId === answer.id).length
              return (
                <article className={`review-target${reviewAnswerId === answer.id ? ' review-target--selected' : ''}`} key={answer.id}>
                  <div className="review-target__content">
                    <span className="avatar">{participant?.nickname.slice(0, 1) ?? '?'}</span>
                    <div><strong>{participant?.nickname ?? '참여자'}</strong><p>{answer.content}</p></div>
                  </div>
                  <Button
                    leadingIcon="rate_review"
                    onClick={() => setReviewAnswerId((current) => current === answer.id ? null : answer.id)}
                    size="sm"
                    variant={reviewAnswerId === answer.id ? 'tonal' : 'outlined'}
                  >
                    검토 {threadCount ? `${threadCount}` : ''}
                  </Button>
                </article>
              )
            })}
            {!stageAnswers.length ? (
              <MascotCue description="참여자가 답변을 제출하면 인라인 검토 댓글을 남길 수 있어요." title="첫 답변을 기다리고 있어요" variant="empty" />
            ) : null}
          </div>
        </Card>

        {reviewAnswer ? (
          <ReviewThreadsPanel
            fieldOptions={[{ label: '단계 답변', value: '단계 답변' }]}
            mode="organizer"
            quote={reviewAnswer.content}
            targetId={reviewAnswer.id}
            targetType="answer"
            title={`${answerAuthor(reviewAnswer, state.participants)?.nickname ?? '참여자'}님의 답변 검토`}
          />
        ) : null}
      </AdminLayout>
      {renderToasts()}
    </OrganizerShell>
  )
}

type OperationsSection = 'participants' | 'submissions' | 'admins' | 'portability'

export function OrganizerOperationsPage({ section }: { section: OperationsSection }) {
  const { authRole, dispatchAsync, manageJoinAccessCode, revealParticipantPin, state } = usePlatform()
  const { notify, renderToasts } = useNotices()
  const [query, setQuery] = useState('')
  const [pinParticipant, setPinParticipant] = useState<Participant | null>(null)
  const [pinReason, setPinReason] = useState('재입장 지원')
  const [pinVisible, setPinVisible] = useState(false)
  const [revealedPin, setRevealedPin] = useState('')
  const [pinLoading, setPinLoading] = useState(false)
  const [joinAccessCode, setJoinAccessCode] = useState('')
  const [joinCodeLoading, setJoinCodeLoading] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [reviewSubmissionId, setReviewSubmissionId] = useState<string | null>(null)
  const [exhibitionUpdating, setExhibitionUpdating] = useState(false)
  const snapshot = state.publishedSnapshot
  const submissionCards = state.participants.flatMap((participant) => {
    const draft = state.submissions.find((submission) => (
      submission.participantId === participant.id && submission.status === 'draft'
    ))
    const submitted = state.submissions.find((submission) => (
      submission.participantId === participant.id && submission.status === 'submitted'
    ))
    const project = draft ?? submitted
    return project ? [{ participant, project, targetId: participant.id }] : []
  })
  const reviewSubmission = submissionCards.find((item) => item.targetId === reviewSubmissionId)

  useEffect(() => {
    if (!pinVisible) return
    const clearPin = () => {
      setPinVisible(false)
      setRevealedPin('')
    }
    const timeout = window.setTimeout(clearPin, 30_000)
    document.addEventListener('visibilitychange', clearPin)
    window.addEventListener('pagehide', clearPin)
    return () => {
      window.clearTimeout(timeout)
      document.removeEventListener('visibilitychange', clearPin)
      window.removeEventListener('pagehide', clearPin)
    }
  }, [pinParticipant?.id, pinVisible])

  useEffect(() => {
    if (!joinAccessCode) return
    const clearCode = () => setJoinAccessCode('')
    const timeout = window.setTimeout(clearCode, 30_000)
    document.addEventListener('visibilitychange', clearCode)
    window.addEventListener('pagehide', clearCode)
    return () => {
      window.clearTimeout(timeout)
      document.removeEventListener('visibilitychange', clearCode)
      window.removeEventListener('pagehide', clearCode)
    }
  }, [joinAccessCode])

  function closePinDialog() {
    setPinVisible(false)
    setRevealedPin('')
    setPinParticipant(null)
  }

  const meta = {
    participants: ['PARTICIPANTS · PRIVATE', '참여자와 재입장 지원', '닉네임, 접속 상태와 개인 제출 현황을 확인합니다. PIN은 명시적인 조회 사유를 입력한 뒤 한 명씩 확인할 수 있습니다.'],
    submissions: ['INDIVIDUAL WORKS', '개인 작품 제출 현황', '참여자마다 한 작품만 제출합니다. 공개 전시에는 제출 완료된 작품만 포함됩니다.'],
    admins: ['ACCESS MANAGEMENT', '관리자 초대와 권한', '초대받은 동일한 Google 계정만 관리자 권한을 수락하고 행사 운영에 참여할 수 있습니다.'],
    portability: ['PORTABLE EVENT DATA', '다른 행사와 도구로 연결', '동일한 공개 리비전에서 JSON, CSV, Markdown, README와 iframe 코드를 만듭니다.'],
  }[section]

  const filtered = state.participants.filter((participant) => participant.nickname.includes(query.trim()))

  async function invite(event: FormEvent) {
    event.preventDefault()
    const ok = announceResult(await dispatchAsync({ type: 'INVITE_ADMIN', email: inviteEmail }), notify)
    if (ok) setInviteEmail('')
  }

  async function manageEntryCode(action: 'reveal' | 'rotate') {
    setJoinCodeLoading(true)
    try {
      const result = await manageJoinAccessCode(action)
      if (announceResult(result, notify)) setJoinAccessCode(result.ok ? result.value : '')
    } finally {
      setJoinCodeLoading(false)
    }
  }

  async function revokeAdmin(inviteId: string) {
    announceResult(await dispatchAsync({ type: 'REVOKE_ADMIN', inviteId }), notify)
  }

  async function revealPin() {
    if (!pinParticipant || !pinReason.trim()) return
    setPinLoading(true)
    const result = await revealParticipantPin(pinParticipant.id, pinReason)
    if (announceResult(result, notify)) {
      setRevealedPin(result.ok ? result.value : '')
      setPinVisible(true)
    }
    setPinLoading(false)
  }

  async function setExhibitionPublished() {
    if (exhibitionUpdating) return
    setExhibitionUpdating(true)
    try {
      announceResult(await dispatchAsync({
        type: 'SET_EXHIBITION_PUBLISHED',
        published: !state.exhibitionPublished,
      }), notify)
    } finally {
      setExhibitionUpdating(false)
    }
  }

  async function copyEmbed() {
    if (!snapshot) return
    await navigator.clipboard.writeText(createEmbedSnippet(snapshot))
    notify('iframe 코드를 클립보드에 복사했어요.')
  }

  function exportFile(format: ExportFormat) {
    if (!snapshot) return
    downloadTextExport(createTextExport(snapshot, format))
    notify(`${format.toUpperCase()} 파일을 만들었어요.`)
  }

  return (
    <OrganizerShell>
      <AdminLayout description={meta[2]} eyebrow={meta[0]} title={meta[1]}>
        {section === 'participants' ? (
          <>
            <div className="grid three">
              <StatCard icon="groups" label="등록" value={`${state.participants.length} / ${state.room.capacity}`} />
              <StatCard icon="history" label="최근 활동" trend="마지막 저장 기준" value={`${state.participants.filter((participant) => Date.now() - Date.parse(participant.lastSeenAt) < 15 * 60_000).length}명`} />
              <StatCard icon="assignment_turned_in" label="개인 제출" value={`${state.submissions.filter((submission) => submission.status === 'submitted').length}명`} />
            </div>
            <Card padding="lg" tone="subtle">
              <SectionHeader
                actions={(
                  <div className="button-row">
                    <Button disabled={joinCodeLoading} leadingIcon="visibility" onClick={() => { void manageEntryCode('reveal') }} variant="outlined">입장 키 확인</Button>
                    <Button disabled={joinCodeLoading} leadingIcon="autorenew" onClick={() => { void manageEntryCode('rotate') }}>새 키 발급</Button>
                  </div>
                )}
                description="신규 닉네임 등록에만 필요한 6자리 키입니다. 현장 참여자에게만 공유하고 노출되었다면 즉시 교체하세요."
                eyebrow="SECURE ADMISSION"
                title="신규 참여자 입장 키"
                titleAs="h2"
              />
              {joinAccessCode ? <div className="pin-reveal"><span>{joinAccessCode}</span><p>30초 뒤 이 기기에서 자동으로 지워집니다.</p></div> : null}
            </Card>
            <OutcomeNote tone="warm"><strong>PIN 조회 정책</strong><br />재입장 지원이 필요한 경우에만 조회 사유를 입력하세요. 한 번에 한 명의 PIN을 30초 동안 확인할 수 있습니다.</OutcomeNote>
            <Card padding="lg">
              <div className="split mobile-stack operations-filter">
                <Field leadingIcon="search" label="닉네임 검색" onChange={(event) => setQuery(event.target.value)} placeholder="참여자 찾기" value={query} />
                <Chip icon="groups" tone="info">최대 100명</Chip>
              </div>
              <div className="list participant-list">
                {filtered.map((participant) => {
                  const submission = state.submissions.find((item) => item.participantId === participant.id)
                  return (
                    <div className="list-item" key={participant.id}>
                      <span className="avatar" style={{ background: `${participant.accent}22`, color: participant.accent }}>{participant.nickname.slice(0, 1)}</span>
                      <span className="list-main"><span className="list-title">{participant.nickname}</span><span className="list-subtitle">PIN · •••• · {submission?.status === 'submitted' ? '작품 제출' : '미제출'}</span></span>
                      <Chip tone={participant.status === 'online' ? 'success' : 'neutral'}>{participant.status === 'online' ? '최근 활동' : '자리 비움'}</Chip>
                      <Button onClick={() => { setPinParticipant(participant); setPinVisible(false); setRevealedPin('') }} size="sm" variant="outlined">PIN 확인</Button>
                    </div>
                  )
                })}
                {!filtered.length ? (
                  <MascotCue
                    description="닉네임 철자를 다시 확인하거나 검색어를 조금 줄여보세요."
                    title="찾는 참여자가 보이지 않아요"
                    variant="lobby"
                  />
                ) : null}
              </div>
            </Card>
          </>
        ) : null}

        {section === 'submissions' ? (
          <>
            <div className="grid three">
              <StatCard icon="rocket_launch" label="제출 완료" value={`${state.submissions.filter((submission) => submission.status === 'submitted').length}명`} />
              <StatCard icon="person" label="제출 단위" trend="팀 제출 없음" value="개인" />
              <StatCard icon="public" label="전시 상태" trend={state.exhibitionPublished ? '외부 공개' : '비공개'} value={state.exhibitionPublished ? 'ON' : 'OFF'} />
            </div>
            <div className="split mobile-stack">
              <OutcomeNote>전시 상태를 바꾸면 새로운 공개 리비전이 만들어져 대시보드와 README도 같은 상태를 사용합니다.</OutcomeNote>
              <Button disabled={exhibitionUpdating} leadingIcon={state.exhibitionPublished ? 'visibility_off' : 'visibility'} onClick={() => { void setExhibitionPublished() }} variant={state.exhibitionPublished ? 'outlined' : 'filled'}>
                {exhibitionUpdating ? '전시 상태 반영 중…' : `전시 ${state.exhibitionPublished ? '회수' : '공개'}`}
              </Button>
            </div>
            {submissionCards.length ? (
              <div className="exhibition-grid">
                {submissionCards.map(({ participant, project, targetId }) => {
                  const reviewCount = state.reviewThreads.filter((thread) => thread.targetType === 'submission' && thread.targetId === targetId).length
                  return (
                    <ProjectCard
                      key={targetId}
                      maker={participant.nickname}
                      onReview={() => setReviewSubmissionId((current) => current === targetId ? null : targetId)}
                      project={project}
                      reviewCount={reviewCount}
                    />
                  )
                })}
              </div>
            ) : (
              <MascotCue
                description="참여자의 첫 번째 개인 작품이 제출되면 이곳에서 검토할 수 있어요."
                title="아직 도착한 작품이 없어요"
                variant="submission"
              />
            )}
            {reviewSubmission ? (
              <ReviewThreadsPanel
                fieldOptions={[
                  { label: '작품명', value: '작품명' },
                  { label: '한 줄 소개', value: '한 줄 소개' },
                  { label: '상세 설명', value: '상세 설명' },
                  { label: '제작 회고', value: '제작 회고' },
                ]}
                mode="organizer"
                quote={reviewSubmission.project.description}
                targetId={reviewSubmission.targetId}
                targetType="submission"
                title={`${reviewSubmission.participant.nickname}님의 작품 검토`}
              />
            ) : null}
          </>
        ) : null}

        {section === 'admins' ? (
          <>
            <div className="grid two">
              <Card padding="lg">
                <SectionHeader description="동일 이메일의 Google 계정으로 수락하는 흐름입니다." eyebrow="EMAIL INVITE" title="관리자 초대" titleAs="h2" />
                {authRole === 'owner' ? <form className="form-grid" onSubmit={invite}>
                  <Field autoComplete="email" label="Google 이메일 주소" onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@gmail.com" required type="email" value={inviteEmail} />
                  <Button leadingIcon="person_add" type="submit">초대 보내기</Button>
                </form> : <OutcomeNote tone="warm">관리자 초대와 해제는 행사 Owner만 할 수 있습니다.</OutcomeNote>}
                <OutcomeNote>입력한 Gmail 또는 Google Workspace 받은편지함으로 초대 링크가 발송됩니다. 링크를 연 뒤 동일한 Google 계정을 선택해야 합니다.</OutcomeNote>
              </Card>
              <Card padding="lg">
                <SectionHeader description="Owner 1명과 초대된 관리자" eyebrow="ACCESS LIST" title="현재 권한" titleAs="h2" />
                <div className="list">
                  <div className="list-item"><span className="avatar">V</span><span className="list-main"><span className="list-title">jammanbogem@gmail.com</span><span className="list-subtitle">행사 생성자</span></span><Chip tone="primary">Owner</Chip></div>
                  {state.adminInvites.map((invite) => {
                    const statusLabel = invite.status === 'accepted' ? '수락됨' : invite.status === 'revoked' ? '해제됨' : '대기 중'
                    const statusTone = invite.status === 'accepted' ? 'success' : invite.status === 'revoked' ? 'neutral' : 'warning'
                    return (
                      <div className="list-item" key={invite.id}>
                        <span className="avatar">A</span>
                        <span className="list-main"><span className="list-title">{invite.email}</span><span className="list-subtitle">{formatDate(invite.invitedAt)}</span></span>
                        <Chip tone={statusTone}>{statusLabel}</Chip>
                        {authRole === 'owner' && (invite.status === 'pending' || (invite.status === 'accepted' && invite.acceptedBy)) ? (
                          <Button onClick={() => { void revokeAdmin(invite.id) }} size="sm" variant="danger">
                            {invite.status === 'pending' ? '초대 취소' : '권한 해제'}
                          </Button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </Card>
            </div>
          </>
        ) : null}

        {section === 'portability' ? (
          <>
            <MascotCue
              className="operations-mascot-cue"
              description="공개 리비전을 필요한 형식으로 내려받아 다음 행사와 다른 서비스에 이어가세요."
              title="행사 기록을 안전하게 옮겨드릴게요"
              variant="submission"
            />
            <div className="grid four export-grid">
              {(['json', 'csv', 'markdown', 'readme'] as ExportFormat[]).map((format) => (
                <Card interactive key={format} padding="lg">
                  <Icon name={format === 'json' ? 'data_object' : format === 'csv' ? 'table_view' : format === 'readme' ? 'menu_book' : 'markdown'} size="xl" />
                  <h3>{format === 'readme' ? 'README.md' : format.toUpperCase()}</h3>
                  <p className="muted">리비전 {snapshot?.revision ?? '-'}의 공개 데이터로 생성</p>
                  <Button disabled={!snapshot} fullWidth onClick={() => exportFile(format)} size="sm" variant="outlined">다운로드</Button>
                </Card>
              ))}
            </div>
            <Card padding="lg">
              <SectionHeader actions={<Button disabled={!snapshot} leadingIcon="content_copy" onClick={copyEmbed} variant="tonal">코드 복사</Button>} description="다른 서비스에 붙여 넣을 수 있는 읽기 전용 대시보드입니다." eyebrow="EMBED" title="iframe 연결" />
              <pre className="code-block">{snapshot ? createEmbedSnippet(snapshot) : '먼저 정리 대시보드를 발행해주세요.'}</pre>
              <OutcomeNote tone="warm">iframe에는 주최자가 발행한 최신 공개 리비전과 공개 허용 범위만 반영됩니다.</OutcomeNote>
            </Card>
          </>
        ) : null}
      </AdminLayout>

      <Dialog
        actions={
          <>
            <Button onClick={closePinDialog} variant="text">닫기</Button>
            <Button disabled={!pinReason.trim() || pinLoading} leadingIcon="visibility" onClick={() => { void revealPin() }} variant="danger">{pinLoading ? '확인 중…' : 'PIN 확인'}</Button>
          </>
        }
        description="재입장 지원을 위해 한 명의 PIN만 30초 동안 확인합니다."
        onClose={closePinDialog}
        open={Boolean(pinParticipant)}
        size="sm"
        title={`${pinParticipant?.nickname ?? ''}님의 재입장 지원`}
      >
        {pinVisible ? (
          <div className="pin-reveal"><span>{revealedPin}</span><p>보안을 위해 30초 뒤 자동으로 가려집니다. 조회 사유는 Firebase 감사 기록에 남습니다.</p></div>
        ) : (
          <Field label="조회 사유" onChange={(event) => setPinReason(event.target.value)} required value={pinReason} />
        )}
      </Dialog>
      {renderToasts()}
    </OrganizerShell>
  )
}

export function SynthesisPage() {
  const navigate = useNavigate()
  const { dispatchAsync, state } = usePlatform()
  const { notify, renderToasts } = useNotices()
  const synthesisDraftKey = `vibecoding.synthesis-draft.v2.${state.room.id}`
  const [summaryDraft, setSummaryDraft] = usePersistentDraft(
    synthesisDraftKey,
    {
      baseRevision: state.synthesis.revision,
      content: state.synthesis.organizerSummary,
    },
  )
  const summary = summaryDraft.content
  const summaryDirty = summary !== state.synthesis.organizerSummary
  const summaryConflict = summaryDirty
    && summaryDraft.baseRevision < state.synthesis.revision
  const [stageFilter, setStageFilter] = useState(state.slides[0].id)
  const [selectedHighlightIds, setSelectedHighlightIds] = useState(state.synthesis.highlightAnswerIds)
  const [selectedThemeIds, setSelectedThemeIds] = useState(state.synthesis.themeIds)
  const [selectedNicknamePolicy, setSelectedNicknamePolicy] = useState(state.synthesis.nicknamePolicy)
  const [publishing, setPublishing] = useState(false)
  const highlightIdsRef = useRef(selectedHighlightIds)
  const themeIdsRef = useRef(selectedThemeIds)
  const nicknamePolicyRef = useRef(selectedNicknamePolicy)
  const synthesisRevisionRef = useRef(state.synthesis.revision)
  const latestSynthesisRef = useRef(state.synthesis)
  latestSynthesisRef.current = state.synthesis
  const synthesisPendingRef = useRef(0)
  const failedSynthesisFieldsRef = useRef(new Set<keyof SynthesisPatch>())
  const synthesisQueueRef = useRef<Promise<boolean>>(Promise.resolve(true))
  const snapshot = state.publishedSnapshot
  const stageAnswers = state.answers.filter((answer) => answer.slideId === stageFilter && answer.status === 'submitted')

  type SynthesisPatch = Omit<UpdateSynthesisInput, 'expectedRevision'>

  function queueSynthesisUpdate(
    input: SynthesisPatch,
    showNotice = true,
  ): Promise<boolean> {
    const fields = Object.keys(input) as (keyof SynthesisPatch)[]
    synthesisPendingRef.current += 1
    const operation = synthesisQueueRef.current.then(async () => {
      const expectedRevision = synthesisRevisionRef.current
      const result = await dispatchAsync<{ revision: number }>({
        type: 'UPDATE_SYNTHESIS',
        input: {
          ...input,
          expectedRevision,
        },
      })
      if (!result.ok) {
        fields.forEach((field) => {
          if (field === 'organizerSummary') failedSynthesisFieldsRef.current.add(field)
          else failedSynthesisFieldsRef.current.delete(field)
        })
        const latest = latestSynthesisRef.current
        synthesisRevisionRef.current = latest.revision
        highlightIdsRef.current = latest.highlightAnswerIds
        themeIdsRef.current = latest.themeIds
        nicknamePolicyRef.current = latest.nicknamePolicy
        setSelectedHighlightIds(latest.highlightAnswerIds)
        setSelectedThemeIds(latest.themeIds)
        setSelectedNicknamePolicy(latest.nicknamePolicy)
        notify(result.error.message, 'danger')
        return failedSynthesisFieldsRef.current.size === 0
      }
      if (Number.isInteger(result.value.revision)) {
        synthesisRevisionRef.current = result.value.revision
        setSummaryDraft((current) => current.baseRevision === expectedRevision
          ? { ...current, baseRevision: result.value.revision }
          : current)
      }
      fields.forEach((field) => failedSynthesisFieldsRef.current.delete(field))
      if (showNotice && result.notice) notify(result.notice, 'success')
      return failedSynthesisFieldsRef.current.size === 0
    }).finally(() => {
      synthesisPendingRef.current -= 1
    })
    synthesisQueueRef.current = operation
    return operation
  }

  const summaryAutosave = useAutosave({
    enabled: summaryDirty && !summaryConflict,
    fingerprint: summary,
    save: async () => {
      const content = summary
      const ok = await queueSynthesisUpdate({ organizerSummary: content }, false)
      if (ok) {
        setSummaryDraft((current) => current.content === content
          ? { ...current, baseRevision: synthesisRevisionRef.current }
          : current)
      }
      return ok
    },
    saveOnMount: summaryDirty && !summaryConflict,
  })
  const markSummaryPhase = summaryAutosave.markPhase

  async function saveSummary() {
    if (summaryConflict) {
      notify('다른 관리자의 최신 요약을 확인하고 내용을 다시 편집한 뒤 저장해주세요.', 'danger')
      return
    }
    const ok = await summaryAutosave.flush()
    if (ok) notify('정리 세션 내용을 저장했습니다.', 'success')
  }

  useEffect(() => {
    if (synthesisPendingRef.current > 0 || publishing) return
    synthesisRevisionRef.current = state.synthesis.revision
    highlightIdsRef.current = state.synthesis.highlightAnswerIds
    themeIdsRef.current = state.synthesis.themeIds
    nicknamePolicyRef.current = state.synthesis.nicknamePolicy
    setSelectedHighlightIds(state.synthesis.highlightAnswerIds)
    setSelectedThemeIds(state.synthesis.themeIds)
    setSelectedNicknamePolicy(state.synthesis.nicknamePolicy)
  }, [
    publishing,
    state.synthesis.highlightAnswerIds,
    state.synthesis.nicknamePolicy,
    state.synthesis.revision,
    state.synthesis.themeIds,
  ])

  useEffect(() => {
    if (!summaryDirty && summaryDraft.baseRevision !== state.synthesis.revision) {
      setSummaryDraft((current) => ({
        ...current,
        baseRevision: state.synthesis.revision,
      }))
    }
  }, [setSummaryDraft, state.synthesis.revision, summaryDirty, summaryDraft.baseRevision])

  useEffect(() => {
    if (summaryConflict) markSummaryPhase('conflict')
  }, [markSummaryPhase, summaryConflict])

  function toggleHighlight(answerId: string) {
    const selected = highlightIdsRef.current.includes(answerId)
    const highlightAnswerIds = selected
      ? highlightIdsRef.current.filter((id) => id !== answerId)
      : [...highlightIdsRef.current, answerId]
    highlightIdsRef.current = highlightAnswerIds
    setSelectedHighlightIds(highlightAnswerIds)
    void queueSynthesisUpdate({ highlightAnswerIds })
  }

  function toggleTheme(themeId: string) {
    const selected = themeIdsRef.current.includes(themeId)
    const themeIds = selected
      ? themeIdsRef.current.filter((id) => id !== themeId)
      : [...themeIdsRef.current, themeId]
    themeIdsRef.current = themeIds
    setSelectedThemeIds(themeIds)
    void queueSynthesisUpdate({ themeIds })
  }

  async function publish() {
    if (publishing) return
    setPublishing(true)
    try {
      if (summaryConflict) {
        notify('다른 관리자가 저장한 최신 요약과 충돌합니다. 내용을 확인한 뒤 다시 발행해주세요.', 'danger')
        return
      }
      const summarySaved = await summaryAutosave.flush()
      const queuedFieldsSaved = await synthesisQueueRef.current
      if (
        !summarySaved
        || !queuedFieldsSaved
        || failedSynthesisFieldsRef.current.size > 0
      ) {
        notify('정리 세션 저장을 확인한 뒤 다시 발행해주세요.', 'danger')
        return
      }
      const result = await dispatchAsync({ type: 'PUBLISH_SYNTHESIS' })
      if (announceResult(result, notify)) window.setTimeout(() => navigate(`/dashboards/${PUBLIC_SLUG}`), 450)
    } finally {
      setPublishing(false)
    }
  }

  return (
    <OrganizerShell>
      <AdminLayout
        actions={<Button disabled={publishing} leadingIcon="publish" onClick={() => { void publish() }}>{publishing ? '발행 준비 중…' : '새 리비전 발행'}</Button>}
        description="각 단계의 개인 답변을 주제와 하이라이트로 묶고, 외부에서 이어 쓸 수 있는 하나의 공개 리비전을 만듭니다."
        eyebrow={`SYNTHESIS · REVISION ${snapshot?.revision ?? 0}`}
        title="흩어진 답을 하나의 행사 이야기로"
      >
        <div className="grid four">
          <StatCard icon="groups" label="참여자" value={`${state.participants.length}명`} />
          <StatCard icon="edit_note" label="제출 답변" value={`${state.answers.filter((answer) => answer.status === 'submitted').length}개`} />
          <StatCard icon="category" label="공개 테마" value={`${selectedThemeIds.length}개`} />
          <StatCard icon="push_pin" label="하이라이트" value={`${selectedHighlightIds.length}개`} />
        </div>

        <div className="synthesis-layout">
          <div className="stack">
            <Card padding="lg">
              <SectionHeader description="원문을 수정하지 않고 주최자의 해석을 별도로 기록합니다." eyebrow="01 · ORGANIZER SUMMARY" title="전체 행사 요약" titleAs="h2" />
              <Textarea
                disabled={publishing}
                helpText={<AutosaveStatus phase={summaryAutosave.phase} savedAt={summaryAutosave.savedAt} />}
                label="주최자 요약"
                maxLength={4000}
                onChange={(event) => setSummaryDraft({
                  baseRevision: state.synthesis.revision,
                  content: event.target.value,
                })}
                rows={9}
                showCount
                value={summary}
              />
              {summaryConflict ? (
                <OutcomeNote tone="warm">
                  다른 관리자가 더 최신 요약을 저장했습니다. 최신 내용을 확인한 뒤 이 입력란을 다시 편집하면 안전하게 저장할 수 있습니다.
                </OutcomeNote>
              ) : null}
              <div className="split mobile-stack synthesis-save">
                <span className="small-text muted">저장 후에도 공개 화면은 다시 발행하기 전까지 바뀌지 않습니다.</span>
                <Button disabled={publishing} leadingIcon="save" onClick={() => { void saveSummary() }} variant="tonal">정리 저장</Button>
              </div>
            </Card>

            <Card padding="lg">
              <SectionHeader description="단계별 답변을 읽고 외부 대시보드에 강조할 문장을 고릅니다." eyebrow="02 · HIGHLIGHTS" title="단계별 핵심 답변" titleAs="h2" />
              <div className="tabs" role="tablist">
                {state.slides.map((slide) => (
                  <button aria-selected={stageFilter === slide.id} className={`tab${stageFilter === slide.id ? ' active' : ''}`} key={slide.id} onClick={() => setStageFilter(slide.id)} role="tab" type="button">{slide.order}. {slide.eyebrow.split(' · ')[0]}</button>
                ))}
              </div>
              <div className="stack compact synthesis-answers">
                {stageAnswers.map((answer) => {
                  const participant = state.participants.find((item) => item.id === answer.participantId)
                  const selected = selectedHighlightIds.includes(answer.id)
                  return (
                    <button aria-pressed={selected} className={`synthesis-answer${selected ? ' selected' : ''}`} disabled={publishing} key={answer.id} onClick={() => toggleHighlight(answer.id)} type="button">
                      <span className="avatar">{participant?.nickname.slice(0, 1)}</span>
                      <span><strong>{participant?.nickname}</strong><span>{answer.content}</span></span>
                      <Icon filled={selected} name={selected ? 'push_pin' : 'keep'} />
                    </button>
                  )
                })}
              </div>
            </Card>
          </div>

          <aside className="stack synthesis-side">
            <Card padding="lg">
              <SectionHeader description="발행할 주제 묶음을 선택합니다." eyebrow="03 · THEMES" title="공개 테마" titleAs="h2" />
              <div className="stack compact">
                {state.themes.map((theme) => {
                  const selected = selectedThemeIds.includes(theme.id)
                  return (
                    <button aria-pressed={selected} className={`theme-toggle${selected ? ' selected' : ''}`} disabled={publishing} key={theme.id} onClick={() => toggleTheme(theme.id)} type="button">
                      <span className="theme-color" style={{ background: theme.color }} />
                      <span><strong>{theme.label}</strong><small>{theme.description}</small></span>
                      <Icon name={selected ? 'check_circle' : 'circle'} />
                    </button>
                  )
                })}
              </div>
            </Card>

            <Card padding="lg" tone="subtle">
              <SectionHeader description="외부 projection을 만들 때 한 번만 적용됩니다." eyebrow="PRIVACY" title="닉네임 공개 정책" titleAs="h2" />
              <Select
                disabled={publishing}
                label="공개 대시보드 작성자"
                onChange={(event) => {
                  const nicknamePolicy = event.target.value as 'nickname' | 'anonymous'
                  nicknamePolicyRef.current = nicknamePolicy
                  setSelectedNicknamePolicy(nicknamePolicy)
                  void queueSynthesisUpdate({ nicknamePolicy })
                }}
                value={selectedNicknamePolicy}
              >
                <option value="nickname">닉네임 표시</option>
                <option value="anonymous">모두 익명화</option>
              </Select>
              <div className="privacy-list">
                <span><Icon name="check" /> 공개 답변과 선택된 댓글</span>
                <span><Icon name="check" /> 집계, 테마, 작품 정보</span>
                <span className="blocked"><Icon name="block" /> PIN, 이메일, 내부 ID</span>
                <span className="blocked"><Icon name="block" /> 비공개 답변과 접속 정보</span>
              </div>
            </Card>

            <Card className="publish-card" padding="lg" tone="dark">
              <CatIllustration decorative size="md" variant="exhibition" />
              <Chip tone="info">현재 공개 R{snapshot?.revision ?? 0}</Chip>
              <h3>수정본을 외부에 반영할까요?</h3>
              <p>발행 시 정제된 불변 스냅샷을 만들고 대시보드와 모든 내보내기가 이 리비전만 읽습니다.</p>
              <Button disabled={publishing} fullWidth leadingIcon="publish" onClick={() => { void publish() }}>새 리비전 발행</Button>
            </Card>
          </aside>
        </div>
      </AdminLayout>
      {renderToasts()}
    </OrganizerShell>
  )
}

function PublicMetrics({ metrics }: { metrics: NonNullable<ReturnType<typeof usePlatform>['state']['publishedSnapshot']>['data']['metrics'] }) {
  return (
    <div className="grid four public-metrics">
      <StatCard icon="groups" label="함께한 참여자" tone="subtle" value={`${metrics.participantCount}명`} />
      <StatCard icon="edit_note" label="개인 답변" tone="subtle" value={`${metrics.submittedAnswerCount}개`} />
      <StatCard icon="forum" label="이어진 댓글" tone="subtle" value={`${metrics.commentCount}개`} />
      <StatCard icon="rocket_launch" label="개인 작품" tone="subtle" value={`${metrics.projectCount}개`} />
    </div>
  )
}

export function DashboardPage() {
  const { state } = usePlatform()
  const snapshot = state.publishedSnapshot

  if (!snapshot) return <PublicEmpty title="아직 공개된 대시보드가 없습니다." />
  const { data } = snapshot

  return (
    <PublicShell>
      <main className="page" id="main-content">
        <section className="dashboard-hero">
          <Chip tone="info">PUBLIC DASHBOARD · R{snapshot.revision}</Chip>
          <h1>{data.title}<br />모두의 기록</h1>
          <p>{data.summary}</p>
          <div className="chip-row dashboard-meta">
            <Chip icon="calendar_month" tone="neutral">{formatDate(data.eventDate)}</Chip>
            <Chip icon="person" tone="neutral">{data.organizerName}</Chip>
            <Chip icon="verified_user" tone="success">정제된 공개 데이터</Chip>
          </div>
          <CatIllustration decorative size="lg" variant="exhibition" />
        </section>

        <section className="section"><PublicMetrics metrics={data.metrics} /></section>

        <section className="section">
          <SectionHeader description="주최자가 단계별 개인 답변을 묶어 발견한 세 가지 공통 방향입니다." eyebrow="COLLECTIVE SIGNALS" title="우리에게 남은 세 개의 테마" />
          <div className="grid three">
            {data.themes.map((theme) => (
              <article className="card theme-board" key={theme.label} style={{ borderTopColor: theme.color }}>
                <span className="eyebrow" style={{ color: theme.color }}>THEME · {theme.answerCount} ANSWERS</span>
                <h2>{theme.label}</h2>
                <p className="muted">{theme.description}</p>
                {theme.excerpts.slice(0, 2).map((excerpt) => <blockquote className="quote" key={excerpt}>“{excerpt}”</blockquote>)}
              </article>
            ))}
          </div>
        </section>

        <section className="section">
          <SectionHeader description="질문을 따라 개인의 관찰이 핵심 경험과 다음 실험으로 발전했습니다." eyebrow="STAGE BY STAGE" title="단계별 수합 기록" />
          <div className="public-stages">
            {data.stages.map((stage) => (
              <article className="public-stage" key={stage.key}>
                <div className="public-stage-number">{String(stage.order).padStart(2, '0')}</div>
                <div className="public-stage-copy">
                  <span className="eyebrow">{stage.eyebrow}</span>
                  <h2>{stage.title}</h2>
                  <p>{stage.prompt}</p>
                </div>
                <div className="public-stage-answers">
                  {stage.answers.slice(0, 3).map((answer) => (
                    <blockquote key={answer.key}>“{answer.content}”<footer>{answer.author.name}</footer></blockquote>
                  ))}
                  {!stage.answers.length ? <span className="muted">이 리비전에 공개된 답변이 없습니다.</span> : null}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="public-cta">
          <div><span className="eyebrow">INDIVIDUAL EXHIBITION</span><h2>{data.metrics.projectCount}개의 아이디어가 작품이 되었습니다.</h2><p>모든 결과물은 한 사람의 이름으로 제출되고, 다음 행사에서도 읽을 수 있는 README로 이어집니다.</p></div>
          <MascotAction label="전시 고양이가 기다려요" variant="exhibition">
            <Button leadingIcon="museum" onClick={() => window.location.assign(`/exhibitions/${PUBLIC_SLUG}`)} size="lg">작품 전시 보기</Button>
          </MascotAction>
        </section>
      </main>
    </PublicShell>
  )
}

export function EmbedDashboardPage() {
  const { state } = usePlatform()
  const snapshot = state.publishedSnapshot
  if (!snapshot) return <PublicEmpty title="발행된 리비전이 없습니다." />
  return (
    <main className="embed-page" id="main-content">
      <header><span className="brand"><span className="brand-mark"><Icon name="hub" /></span>VibeCoding</span><Chip tone="info">R{snapshot.revision} · EMBED</Chip></header>
      <h1>{snapshot.data.title}</h1>
      <p>{snapshot.data.summary}</p>
      <PublicMetrics metrics={snapshot.data.metrics} />
      <div className="grid three">{snapshot.data.themes.map((theme) => <Card key={theme.label} padding="md"><span className="theme-color" style={{ background: theme.color }} /><h2>{theme.label}</h2><p className="muted">{theme.description}</p></Card>)}</div>
      <footer>공개 리비전 {snapshot.revision} · 민감 정보가 제거된 읽기 전용 데이터</footer>
    </main>
  )
}

function ProjectCard({
  project,
  maker,
  onOpen,
  onReview,
  reviewCount = 0,
}: {
  project: PublicProject | Submission
  maker: string
  onOpen?: () => void
  onReview?: () => void
  reviewCount?: number
}) {
  return (
    <article className="card project-card interactive">
      {onOpen ? (
        <button aria-label={`${project.title} 상세 보기`} className="project-cover" onClick={onOpen} type="button">
          <img alt="" src={project.coverImage} />
        </button>
      ) : (
        <div className="project-cover"><img alt="" src={project.coverImage} /></div>
      )}
      <div className="project-content">
        <span className="eyebrow">MADE BY {maker}</span>
        <h2>{project.title}</h2>
        <p>{project.pitch}</p>
        <div className="chip-row">{project.tags.slice(0, 3).map((tag) => <Chip key={tag}>{tag}</Chip>)}</div>
        {onOpen || onReview ? (
          <div className="project-card__actions">
            {onOpen ? <Button fullWidth onClick={onOpen} size="sm" variant="text">작품 이야기 보기</Button> : null}
            {onReview ? (
              <Button leadingIcon="rate_review" onClick={onReview} size="sm" variant="tonal">
                검토 {reviewCount ? reviewCount : ''}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  )
}

export function ExhibitionPage() {
  const navigate = useNavigate()
  const { submissionSlug } = useParams()
  const { state } = usePlatform()
  const snapshot = state.publishedSnapshot
  const projects = snapshot?.data.projects ?? []
  const [selectedKey, setSelectedKey] = useState<string | null>(submissionSlug ?? null)
  const selected = projects.find((project) => project.key === selectedKey) ?? null

  if (!snapshot || !snapshot.data.exhibitionPublished) return <PublicEmpty title="전시가 아직 공개되지 않았습니다." />

  function openProject(project: PublicProject) {
    setSelectedKey(project.key)
    navigate(`/exhibitions/${PUBLIC_SLUG}/${project.key}`, { replace: true })
  }

  function closeProject() {
    setSelectedKey(null)
    navigate(`/exhibitions/${PUBLIC_SLUG}`, { replace: true })
  }

  return (
    <PublicShell>
      <main className="page" id="main-content">
        <section className="exhibition-hero">
          <div>
            <span className="eyebrow">INDIVIDUAL WORKS · 2026</span>
            <h1>각자의 질문이<br />작품이 된 순간</h1>
            <p>모든 결과물은 개인 제출입니다. 단계별 기록과 제작 회고까지 다음 행사에 이어질 수 있는 형태로 남았습니다.</p>
            <div className="chip-row"><Chip icon="person" tone="primary">개인 작품 {projects.length}개</Chip><Chip icon="public" tone="success">전시 공개 중</Chip></div>
          </div>
          <img alt="완성된 작품 전시를 안내하는 고양이" src="/assets/retro/retro-cat-collaboration.webp" />
        </section>
        <section className="section">
          <SectionHeader description="카드를 열어 데모, GitHub 링크와 제작자의 회고를 확인하세요." eyebrow="GALLERY" title="오늘 완성된 작품" />
          <div className="exhibition-grid">{projects.map((project) => <ProjectCard key={project.key} maker={project.maker.name} onOpen={() => openProject(project)} project={project} />)}</div>
        </section>
        <section className="public-cta compact-cta">
          <div><span className="eyebrow">PORTABLE BY DESIGN</span><h2>전시의 끝은 다음 행사의 시작</h2><p>README, JSON, CSV와 Markdown으로 데이터를 이어받을 수 있습니다.</p></div>
          <Button leadingIcon="dashboard" onClick={() => navigate(`/dashboards/${PUBLIC_SLUG}`)} size="lg" variant="tonal">수합 대시보드</Button>
        </section>
      </main>

      <Dialog
        actions={selected ? <><Button onClick={closeProject} variant="text">닫기</Button>{selected.githubUrl ? <Button leadingIcon="code" onClick={() => window.open(selected.githubUrl, '_blank', 'noopener,noreferrer')} variant="outlined">GitHub</Button> : null}{selected.demoUrl ? <Button leadingIcon="arrow_outward" onClick={() => window.open(selected.demoUrl, '_blank', 'noopener,noreferrer')}>데모 열기</Button> : null}</> : undefined}
        onClose={closeProject}
        open={Boolean(selected)}
        size="lg"
        title={selected?.title ?? '작품 상세'}
      >
        {selected ? <div className="project-detail"><img alt={`${selected.title} 대표 이미지`} src={selected.coverImage} /><div><Chip tone="primary">{selected.maker.name}의 개인 작품</Chip><p className="project-pitch">{selected.pitch}</p><p>{selected.description}</p><h3>제작 회고</h3><blockquote>{selected.retrospective}</blockquote><div className="chip-row">{selected.tags.map((tag) => <Chip key={tag}>{tag}</Chip>)}</div></div></div> : null}
      </Dialog>
    </PublicShell>
  )
}

function PublicEmpty({ title }: { title: string }) {
  return (
    <PublicShell>
      <main className="page narrow" id="main-content">
        <Card className="empty-state" padding="lg">
          <CatIllustration size="lg" variant="exhibition" />
          <h1>{title}</h1>
          <p>주최자 콘솔에서 정리 세션을 발행하거나 전시를 공개해주세요.</p>
          <Button onClick={() => window.location.assign('/')}>홈으로 돌아가기</Button>
        </Card>
      </main>
    </PublicShell>
  )
}

export function NotFoundPage() {
  return (
    <PublicShell>
      <main className="page narrow" id="main-content">
        <Card className="empty-state" padding="lg">
          <CatIllustration size="lg" variant="lobby" />
          <h1>이 페이지는 아직 준비 중이에요.</h1>
          <p>VibeCoding 홈에서 참여할 행사나 공개 전시를 찾아보세요.</p>
          <ResultLink to="/">홈으로 돌아가기</ResultLink>
        </Card>
      </main>
    </PublicShell>
  )
}
