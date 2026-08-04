import type {
  Answer,
  Participant,
  PrototypeState,
  PublicAnswer,
  PublicAuthor,
  PublicEventProjection,
  PublishedSnapshot,
} from './models'

function publicAuthor(
  participant: Participant | undefined,
  policy: PrototypeState['synthesis']['nicknamePolicy'],
): PublicAuthor {
  return {
    name: policy === 'anonymous' ? '익명의 참가자' : (participant?.nickname ?? '알 수 없는 참가자'),
  }
}

function toPublicAnswer(
  state: PrototypeState,
  answer: Answer,
  key: string,
): PublicAnswer {
  const comments = state.comments
    .filter((comment) => comment.answerId === answer.id)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((comment) => ({
      author: publicAuthor(
        state.participants.find((participant) => participant.id === comment.participantId),
        state.synthesis.nicknamePolicy,
      ),
      body: comment.body,
      createdAt: comment.createdAt,
    }))

  return {
    key,
    author: publicAuthor(
      state.participants.find((participant) => participant.id === answer.participantId),
      state.synthesis.nicknamePolicy,
    ),
    content: answer.content,
    submittedAt: answer.submittedAt ?? answer.updatedAt,
    comments,
  }
}

/**
 * The only gateway from the private event domain to public/exported data.
 * It deliberately reconstructs every public object instead of spreading private
 * entities so future additions such as email or audit fields cannot leak by accident.
 */
export function sanitizeForPublic(state: PrototypeState): PublicEventProjection {
  const submittedAnswers = state.answers.filter((answer) => answer.status === 'submitted')
  const exposedAnswers = submittedAnswers.filter(
    (answer) => state.live.answersRevealedBySlide[answer.slideId] === true,
  )
  const answerKeyById = new Map<string, string>()

  const stages = [...state.slides]
    .sort((left, right) => left.order - right.order)
    .map((slide) => {
      const slideAnswers = exposedAnswers
        .filter((answer) => answer.slideId === slide.id)
        .sort((left, right) =>
          (left.submittedAt ?? left.updatedAt).localeCompare(right.submittedAt ?? right.updatedAt),
        )
      const answers = slideAnswers.map((answer, index) => {
        const key = `response-${slide.order}-${index + 1}`
        answerKeyById.set(answer.id, key)
        return toPublicAnswer(state, answer, key)
      })

      return {
        key: `stage-${slide.order}`,
        order: slide.order,
        eyebrow: slide.eyebrow,
        title: slide.title,
        prompt: slide.prompt,
        answers,
      }
    })

  const selectedThemes = state.synthesis.themeIds
    .map((themeId) => state.themes.find((theme) => theme.id === themeId))
    .filter((theme): theme is NonNullable<typeof theme> => theme !== undefined)
    .map((theme) => {
      const themeAnswers = theme.answerIds
        .map((answerId) => exposedAnswers.find((answer) => answer.id === answerId))
        .filter((answer): answer is Answer => answer !== undefined)
      return {
        label: theme.label,
        description: theme.description,
        color: theme.color,
        answerCount: themeAnswers.length,
        excerpts: themeAnswers.slice(0, 3).map((answer) => answer.content),
      }
    })

  const publicAnswerByInternalId = new Map<string, PublicAnswer>()
  exposedAnswers.forEach((answer) => {
    const publicKey = answerKeyById.get(answer.id)
    if (publicKey) publicAnswerByInternalId.set(answer.id, toPublicAnswer(state, answer, publicKey))
  })

  const highlights = state.synthesis.highlightAnswerIds
    .map((answerId) => publicAnswerByInternalId.get(answerId))
    .filter((answer): answer is PublicAnswer => answer !== undefined)

  const submittedProjects = state.submissions
    .filter((submission) => submission.status === 'submitted')
    .sort((left, right) =>
      (left.submittedAt ?? left.updatedAt).localeCompare(right.submittedAt ?? right.updatedAt),
    )
  const projects = state.exhibitionPublished
    ? submittedProjects.map((submission, index) => ({
        key: `project-${index + 1}`,
        maker: publicAuthor(
          state.participants.find((participant) => participant.id === submission.participantId),
          state.synthesis.nicknamePolicy,
        ),
        title: submission.title,
        pitch: submission.pitch,
        description: submission.description,
        demoUrl: submission.demoUrl,
        githubUrl: submission.githubUrl,
        tags: [...submission.tags],
        retrospective: submission.retrospective,
        coverImage: submission.coverImage,
        submittedAt: submission.submittedAt ?? submission.updatedAt,
      }))
    : []

  const respondingParticipants = new Set(submittedAnswers.map((answer) => answer.participantId)).size

  return {
    title: state.room.title,
    tagline: state.room.tagline,
    organizerName: state.room.organizerName,
    eventDate: state.room.eventDate,
    roomCode: state.room.code,
    capacity: state.room.capacity,
    summary: state.synthesis.organizerSummary,
    nicknamePolicy: state.synthesis.nicknamePolicy,
    metrics: {
      participantCount: state.participants.length,
      submittedAnswerCount: submittedAnswers.length,
      commentCount: state.comments.length,
      projectCount: submittedProjects.length,
      completionRate:
        state.participants.length === 0
          ? 0
          : Math.round((respondingParticipants / state.participants.length) * 100),
    },
    stages,
    themes: selectedThemes,
    highlights,
    exhibitionPublished: state.exhibitionPublished,
    projects,
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    Object.values(value as Record<string, unknown>).forEach((child) => deepFreeze(child))
  }
  return value
}

export function createPublishedSnapshot(
  state: PrototypeState,
  publishedAt: string,
): PublishedSnapshot {
  const nextPublicationRevision = (state.publishedSnapshot?.revision ?? 0) + 1
  return deepFreeze({
    revision: nextPublicationRevision,
    publishedAt,
    data: sanitizeForPublic(state),
  })
}

export function freezePublishedSnapshot(snapshot: PublishedSnapshot): PublishedSnapshot {
  return deepFreeze(snapshot)
}

export function containsPrivatePublicFields(value: unknown): boolean {
  const serializedKeys: string[] = []
  const walk = (candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object') return
    Object.entries(candidate).forEach(([key, child]) => {
      serializedKeys.push(key.toLocaleLowerCase())
      walk(child)
    })
  }
  walk(value)
  return serializedKeys.some((key) =>
    ['pin', 'email', 'participantid', 'normalizednickname', 'admininvites'].includes(key),
  )
}
