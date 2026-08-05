import { useMemo, type FormEvent } from 'react'
import { usePlatform } from '../app/PlatformProvider'
import type { ReviewThread, ReviewTargetType } from '../domain/models'
import { usePersistentDraft } from '../platform/usePersistentDraft'
import {
  Button,
  Card,
  CatIllustration,
  Chip,
  Icon,
  SectionHeader,
  Select,
  Textarea,
} from '../ui'
import { announceResult, formatDate, useNotices } from './shared'

interface ReviewThreadsPanelProps {
  fieldOptions: Array<{ label: string; value: string }>
  mode: 'organizer' | 'participant'
  participantId?: string
  quote?: string
  targetId: string
  targetType: ReviewTargetType
  title: string
}

function messageAuthor(
  thread: ReviewThread,
  messageId: string,
  participants: ReturnType<typeof usePlatform>['state']['participants'],
) {
  const message = thread.messages.find((candidate) => candidate.id === messageId)
  if (!message) return '알 수 없음'
  if (message.authorRole === 'organizer') return '주최자'
  return participants.find((participant) => participant.id === message.participantId)?.nickname ?? '참여자'
}

function ThreadCard({
  mode,
  notify,
  participantId,
  thread,
}: {
  mode: ReviewThreadsPanelProps['mode']
  notify: ReturnType<typeof useNotices>['notify']
  participantId?: string
  thread: ReviewThread
}) {
  const { dispatch, state } = usePlatform()
  const draftKey = `vibecoding.review-reply.${thread.id}.${mode}.${participantId ?? 'organizer'}`
  const [reply, setReply, clearReply] = usePersistentDraft(draftKey, '')

  function addReply(event: FormEvent) {
    event.preventDefault()
    const ok = announceResult(
      dispatch({
        type: 'ADD_REVIEW_REPLY',
        input: {
          threadId: thread.id,
          authorRole: mode,
          participantId,
          body: reply,
        },
      }),
      notify,
    )
    if (ok) clearReply()
  }

  function toggleStatus() {
    announceResult(
      dispatch({
        type: 'SET_REVIEW_THREAD_STATUS',
        input: {
          threadId: thread.id,
          authorRole: mode,
          participantId,
          status: thread.status === 'open' ? 'resolved' : 'open',
        },
      }),
      notify,
    )
  }

  return (
    <article className={`review-thread review-thread--${thread.status}`}>
      <header className="review-thread__header">
        <span>
          <Icon name={thread.status === 'open' ? 'rate_review' : 'task_alt'} size="sm" />
          <strong>{thread.field}</strong>
        </span>
        <Chip tone={thread.status === 'open' ? 'warning' : 'success'}>
          {thread.status === 'open' ? '검토 중' : '해결됨'}
        </Chip>
      </header>
      {thread.quote ? <blockquote className="review-thread__quote">“{thread.quote}”</blockquote> : null}
      <div className="review-thread__messages">
        {thread.messages.map((message) => (
          <div className="review-message" key={message.id}>
            <div>
              <strong>{messageAuthor(thread, message.id, state.participants)}</strong>
              <time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time>
            </div>
            <p>{message.body}</p>
          </div>
        ))}
      </div>
      <form className="review-reply" onSubmit={addReply}>
        <Textarea
          helpText="작성 중인 답글은 이 기기에 자동 저장됩니다."
          label="답글"
          maxLength={1000}
          onChange={(event) => setReply(event.target.value)}
          placeholder={mode === 'organizer' ? '추가 안내를 남겨주세요.' : '수정 내용이나 질문에 답해주세요.'}
          rows={3}
          value={reply}
        />
        <div className="review-thread__actions">
          <Button leadingIcon={thread.status === 'open' ? 'check' : 'refresh'} onClick={toggleStatus} size="sm" type="button" variant="text">
            {thread.status === 'open' ? '해결' : '다시 열기'}
          </Button>
          <Button disabled={!reply.trim()} leadingIcon="reply" size="sm" type="submit">답글</Button>
        </div>
      </form>
    </article>
  )
}

export function ReviewThreadsPanel({
  fieldOptions,
  mode,
  participantId,
  quote = '',
  targetId,
  targetType,
  title,
}: ReviewThreadsPanelProps) {
  const { state, dispatch } = usePlatform()
  const { notify, renderToasts } = useNotices()
  const composerKey = `vibecoding.review-composer.${targetType}.${targetId}`
  const [composer, setComposer, clearComposer] = usePersistentDraft(composerKey, {
    body: '',
    field: fieldOptions[0]?.value ?? '전체',
  })
  const threads = useMemo(
    () => state.reviewThreads
      .filter((thread) => thread.targetType === targetType && thread.targetId === targetId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [state.reviewThreads, targetId, targetType],
  )

  function createThread(event: FormEvent) {
    event.preventDefault()
    const ok = announceResult(
      dispatch({
        type: 'ADD_REVIEW_THREAD',
        input: {
          targetType,
          targetId,
          field: composer.field,
          quote,
          body: composer.body,
        },
      }),
      notify,
    )
    if (ok) clearComposer()
  }

  return (
    <Card className="review-sheet" padding="lg" tone="subtle">
      <div className="review-sheet__intro">
        <CatIllustration decorative size="sm" variant={mode === 'organizer' ? 'review' : 'comment'} />
        <SectionHeader
          description={mode === 'organizer'
            ? '자료 소유 참여자에게만 보이는 비공개 의견입니다.'
            : '주최자와 나만 볼 수 있는 검토 대화입니다.'}
          eyebrow="PRIVATE REVIEW"
          title={title}
          titleAs="h2"
        />
      </div>

      {mode === 'organizer' ? (
        <form className="review-composer" onSubmit={createThread}>
          <Select
            label="댓글 위치"
            onChange={(event) => setComposer((current) => ({ ...current, field: event.target.value }))}
            value={composer.field}
          >
            {fieldOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
          <Textarea
            helpText="작성 중인 의견은 이 기기에 자동 저장됩니다. 등록 전에는 참여자에게 보이지 않습니다."
            label="새 검토 댓글"
            maxLength={1000}
            onChange={(event) => setComposer((current) => ({ ...current, body: event.target.value }))}
            placeholder="구체적인 질문이나 다음 수정 방향을 남겨주세요."
            rows={4}
            value={composer.body}
          />
          <Button disabled={!composer.body.trim()} leadingIcon="add_comment" type="submit">댓글 등록</Button>
        </form>
      ) : null}

      <div className="review-thread-list">
        {threads.map((thread) => (
          <ThreadCard key={thread.id} mode={mode} notify={notify} participantId={participantId} thread={thread} />
        ))}
        {!threads.length ? (
          <div className="review-empty">
            <CatIllustration decorative size="sm" variant="empty" />
            <div><strong>아직 검토 댓글이 없어요.</strong><p>{mode === 'organizer' ? '첫 의견을 남겨 참여자의 다음 수정을 도와주세요.' : '새 의견이 도착하면 이곳에서 답글을 남길 수 있어요.'}</p></div>
          </div>
        ) : null}
      </div>
      {renderToasts()}
    </Card>
  )
}
