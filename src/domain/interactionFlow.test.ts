import { describe, expect, it } from 'vitest'
import { executePlatformCommand } from './commands'
import type { Participant, PrototypeState } from './models'
import { containsPrivatePublicFields } from './publicProjection'
import { createSeedState } from './seed'

const baseTime = Date.parse('2026-08-05T01:00:00.000Z')
const env = {
  now: () => baseTime,
  createId: (prefix: string) => `${prefix}-flow`,
}

function run(state: PrototypeState, command: Parameters<typeof executePlatformCommand>[1]) {
  const outcome = executePlatformCommand(state, command, env)
  expect(outcome.result.ok).toBe(true)
  return outcome.state
}

describe('organizer and participant domain workflow', () => {
  it('projects entry, live answer, comment and project data into a publication', () => {
    let state = createSeedState()
    state.room.lifecycle = 'lobby'
    const joined = executePlatformCommand(
      state,
      { type: 'JOIN_PARTICIPANT', input: { roomCode: 'VIBE26', nickname: '검증 별빛', pin: '2468' } },
      env,
    )
    expect(joined.result.ok).toBe(true)
    const participant = joined.result.ok ? joined.result.value as Participant : null
    expect(participant).not.toBeNull()
    state = joined.state

    state = run(state, { type: 'START_SESSION' })
    state = run(state, { type: 'SET_ACTIVE_SLIDE', slideIndex: 3 })
    const slideId = state.slides[3].id
    state = run(state, {
      type: 'SAVE_ANSWER',
      input: { participantId: participant!.id, slideId, content: '다음 행사에서도 전체 흐름을 검증합니다.' },
    })
    const answer = state.answers.find(
      (candidate) => candidate.participantId === participant!.id && candidate.slideId === slideId,
    )
    expect(answer?.status).toBe('submitted')

    state = run(state, { type: 'SET_ANSWERS_REVEALED', slideId, revealed: true })
    const lockedEdit = executePlatformCommand(
      state,
      {
        type: 'SAVE_ANSWER',
        input: { participantId: participant!.id, slideId, content: '공개 후 수정 시도' },
      },
      env,
    )
    expect(lockedEdit.result).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } })

    state = run(state, { type: 'SET_COMMENTS_ENABLED', slideId, enabled: true })
    state = run(state, {
      type: 'ADD_COMMENT',
      input: { participantId: participant!.id, answerId: answer!.id, body: '댓글 연결도 확인했습니다.' },
    })
    expect(state.comments.at(-1)?.body).toBe('댓글 연결도 확인했습니다.')

    state = run(state, {
      type: 'SUBMIT_PROJECT',
      input: {
        participantId: participant!.id,
        title: '검증 고양이 보드',
        pitch: '행사 상호작용을 끝까지 검증합니다.',
        description: '주최자와 참여자의 전체 흐름을 연결합니다.',
        githubUrl: 'https://github.com/jammanbogem-hsy/seongjang',
        tags: ['QA', 'React'],
        retrospective: '공개 리비전과 전시까지 확인했습니다.',
        submit: true,
      },
    })
    state = run(state, { type: 'PUBLISH_SYNTHESIS' })

    expect(state.publishedSnapshot?.data.projects.some((project) => project.title === '검증 고양이 보드')).toBe(true)
    const publishedStage = state.publishedSnapshot?.data.stages.find(
      (stage) => stage.key === `stage-${state.slides[3].order}`,
    )
    const publishedAnswer = publishedStage?.answers.find(
      (candidate) => candidate.content === '다음 행사에서도 전체 흐름을 검증합니다.',
    )
    expect(publishedAnswer).toBeDefined()
    expect(publishedAnswer?.comments.some((comment) => comment.body === '댓글 연결도 확인했습니다.')).toBe(true)
    expect(state.publishedSnapshot && containsPrivatePublicFields(state.publishedSnapshot.data)).toBe(false)
    expect(JSON.stringify(state.publishedSnapshot)).not.toContain('2468')
  })

  it('enforces the active question and timer deadline for drafts and submissions', () => {
    let state = createSeedState()
    state = run(state, { type: 'SET_ACTIVE_SLIDE', slideIndex: 3 })
    const participantId = state.participants[0].id
    const activeSlideId = state.slides[3].id

    const staleSlide = executePlatformCommand(
      state,
      {
        type: 'SAVE_ANSWER',
        input: { participantId, slideId: state.slides[0].id, content: '지난 질문 답변', submit: false },
      },
      env,
    )
    expect(staleSlide.result).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } })

    const started = executePlatformCommand(state, { type: 'START_TIMER' }, env)
    expect(started.result.ok).toBe(true)
    const afterDeadline = {
      ...env,
      now: () => baseTime + state.slides[3].durationSec * 1_000 + 1,
    }
    const lateDraft = executePlatformCommand(
      started.state,
      {
        type: 'SAVE_ANSWER',
        input: { participantId, slideId: activeSlideId, content: '마감 이후 초안', submit: false },
      },
      afterDeadline,
    )
    expect(lateDraft.result).toMatchObject({
      ok: false,
      error: { code: 'NOT_ALLOWED', message: '답변 시간이 종료되어 더 이상 저장할 수 없어요.' },
    })
  })

  it('keeps comment ownership and reveal gates intact', () => {
    let state = createSeedState()
    const slideId = state.slides[2].id
    const answer = state.answers.find((candidate) => candidate.slideId === slideId && candidate.status === 'submitted')!
    const owner = state.participants[0]
    const other = state.participants.find((candidate) => candidate.id !== owner.id)!

    state = run(state, { type: 'SET_COMMENTS_ENABLED', slideId, enabled: true })
    const added = executePlatformCommand(
      state,
      { type: 'ADD_COMMENT', input: { participantId: owner.id, answerId: answer.id, body: '내 댓글' } },
      env,
    )
    expect(added.result.ok).toBe(true)
    const commentId = added.state.comments.at(-1)!.id

    const unauthorizedUpdate = executePlatformCommand(
      added.state,
      { type: 'UPDATE_COMMENT', input: { participantId: other.id, commentId, body: '가로채기' } },
      env,
    )
    expect(unauthorizedUpdate.result).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } })

    const hidden = executePlatformCommand(
      added.state,
      { type: 'SET_ANSWERS_REVEALED', slideId, revealed: false },
      env,
    )
    expect(hidden.state.live.commentsEnabledBySlide[slideId]).toBe(false)
    const blockedComment = executePlatformCommand(
      hidden.state,
      { type: 'ADD_COMMENT', input: { participantId: owner.id, answerId: answer.id, body: '비공개 댓글' } },
      env,
    )
    expect(blockedComment.result).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } })
  })

  it('keeps organizer review threads private while allowing the owner to reply and resolve', () => {
    let state = createSeedState()
    const target = state.answers[0]
    const owner = state.participants.find((participant) => participant.id === target.participantId)!
    const other = state.participants.find((participant) => participant.id !== target.participantId)!
    const created = executePlatformCommand(
      state,
      {
        type: 'ADD_REVIEW_THREAD',
        input: {
          targetType: 'answer',
          targetId: target.id,
          field: '단계 답변',
          quote: target.content,
          body: '주최자만 시작할 수 있는 비공개 검토 의견입니다.',
        },
      },
      env,
    )
    expect(created.result.ok).toBe(true)
    state = created.state
    const thread = state.reviewThreads.at(-1)!

    const unauthorized = executePlatformCommand(
      state,
      {
        type: 'ADD_REVIEW_REPLY',
        input: { threadId: thread.id, authorRole: 'participant', participantId: other.id, body: '다른 사람 답글' },
      },
      env,
    )
    expect(unauthorized.result).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } })

    state = run(state, {
      type: 'ADD_REVIEW_REPLY',
      input: { threadId: thread.id, authorRole: 'participant', participantId: owner.id, body: '자료 소유자의 답글입니다.' },
    })
    state = run(state, {
      type: 'SET_REVIEW_THREAD_STATUS',
      input: { threadId: thread.id, authorRole: 'participant', participantId: owner.id, status: 'resolved' },
    })
    expect(state.reviewThreads.at(-1)?.status).toBe('resolved')

    state = run(state, { type: 'PUBLISH_SYNTHESIS' })
    const publicSnapshot = JSON.stringify(state.publishedSnapshot)
    expect(publicSnapshot).not.toContain('주최자만 시작할 수 있는 비공개 검토 의견입니다.')
    expect(publicSnapshot).not.toContain('자료 소유자의 답글입니다.')
  })
})
