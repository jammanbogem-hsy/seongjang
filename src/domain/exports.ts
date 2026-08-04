import type { PublishedSnapshot } from './models'

export type ExportFormat = 'json' | 'csv' | 'markdown' | 'readme'

export interface TextExport {
  filename: string
  mimeType: string
  content: string
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .toLocaleLowerCase()
  return slug || 'vibecoding-event'
}

function csvCell(value: string | number): string {
  const rawValue = String(value)
  const stringValue = /^[\s]*[=+\-@]/.test(rawValue) || /^[\t\r]/.test(rawValue)
    ? `'${rawValue}`
    : rawValue
  return /[",\n\r]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue
}

export function snapshotToJson(snapshot: PublishedSnapshot): string {
  return JSON.stringify(snapshot, null, 2)
}

export function snapshotToCsv(snapshot: PublishedSnapshot): string {
  const rows: Array<Array<string | number>> = [
    ['record_type', 'stage', 'title', 'author', 'content', 'url', 'tags', 'published_revision'],
  ]

  snapshot.data.stages.forEach((stage) => {
    stage.answers.forEach((answer) => {
      rows.push([
        'answer',
        stage.title,
        '',
        answer.author.name,
        answer.content,
        '',
        '',
        snapshot.revision,
      ])
      answer.comments.forEach((comment) => {
        rows.push([
          'comment',
          stage.title,
          '',
          comment.author.name,
          comment.body,
          '',
          '',
          snapshot.revision,
        ])
      })
    })
  })

  snapshot.data.projects.forEach((project) => {
    rows.push([
      'project',
      '',
      project.title,
      project.maker.name,
      `${project.pitch}\n${project.description}`,
      project.demoUrl || project.githubUrl,
      project.tags.join('|'),
      snapshot.revision,
    ])
  })

  return rows.map((row) => row.map(csvCell).join(',')).join('\n')
}

export function snapshotToMarkdown(snapshot: PublishedSnapshot): string {
  const { data } = snapshot
  const lines = [
    `# ${data.title} — 수합 대시보드`,
    '',
    `> ${data.tagline}`,
    '',
    `- 공개 리비전: ${snapshot.revision}`,
    `- 공개 시각: ${snapshot.publishedAt}`,
    `- 참가자: ${data.metrics.participantCount}명`,
    `- 개인 답변: ${data.metrics.submittedAnswerCount}개`,
    `- 개인 작품: ${data.metrics.projectCount}개`,
    '',
    '## 주최자 정리',
    '',
    data.summary,
    '',
    '## 발견한 테마',
    '',
    ...data.themes.flatMap((theme) => [
      `### ${theme.label} · 답변 ${theme.answerCount}개`,
      '',
      theme.description,
      '',
      ...theme.excerpts.map((excerpt) => `- ${excerpt}`),
      '',
    ]),
    '## 단계별 기록',
    '',
    ...data.stages.flatMap((stage) => [
      `### ${stage.order}. ${stage.title}`,
      '',
      `**질문:** ${stage.prompt}`,
      '',
      ...(stage.answers.length
        ? stage.answers.flatMap((answer) => [
            `- **${answer.author.name}** — ${answer.content}`,
            ...answer.comments.map(
              (comment) => `  - 댓글 · **${comment.author.name}** — ${comment.body}`,
            ),
          ])
        : ['- 공개된 답변이 없습니다.']),
      '',
    ]),
  ]

  return lines.join('\n').trimEnd() + '\n'
}

export function snapshotToReadme(snapshot: PublishedSnapshot): string {
  const { data } = snapshot
  const projectLines = data.exhibitionPublished
    ? data.projects.flatMap((project) => [
        `### ${project.title} · ${project.maker.name}`,
        '',
        project.pitch,
        '',
        project.description,
        '',
        `- 태그: ${project.tags.join(', ')}`,
        ...(project.demoUrl ? [`- [데모 보기](${project.demoUrl})`] : []),
        ...(project.githubUrl ? [`- [GitHub 보기](${project.githubUrl})`] : []),
        `- 회고: ${project.retrospective}`,
        '',
      ])
    : ['_전시가 아직 공개되지 않았습니다._', '']

  return [
    `# ${data.title}`,
    '',
    data.tagline,
    '',
    '## 행사 결과',
    '',
    `참가자 ${data.metrics.participantCount}명이 개인 답변 ${data.metrics.submittedAnswerCount}개와 개인 작품 ${data.metrics.projectCount}개를 만들었습니다.`,
    '',
    data.summary,
    '',
    '## 핵심 테마',
    '',
    ...data.themes.map((theme) => `- **${theme.label}** — ${theme.description}`),
    '',
    '## 개인 작품 전시',
    '',
    ...projectLines,
    '---',
    '',
    `VibeCoding 공개 데이터 리비전 ${snapshot.revision} · ${snapshot.publishedAt}`,
    '',
  ].join('\n')
}

export function createTextExport(
  snapshot: PublishedSnapshot,
  format: ExportFormat,
): TextExport {
  const base = slugify(snapshot.data.title)
  switch (format) {
    case 'json':
      return {
        filename: `${base}-r${snapshot.revision}.json`,
        mimeType: 'application/json;charset=utf-8',
        content: snapshotToJson(snapshot),
      }
    case 'csv':
      return {
        filename: `${base}-r${snapshot.revision}.csv`,
        mimeType: 'text/csv;charset=utf-8',
        content: snapshotToCsv(snapshot),
      }
    case 'readme':
      return { filename: 'README.md', mimeType: 'text/markdown;charset=utf-8', content: snapshotToReadme(snapshot) }
    case 'markdown':
      return {
        filename: `${base}-dashboard-r${snapshot.revision}.md`,
        mimeType: 'text/markdown;charset=utf-8',
        content: snapshotToMarkdown(snapshot),
      }
  }
}

export function createEmbedSnippet(
  snapshot: PublishedSnapshot,
  origin = typeof window === 'undefined' ? 'https://vibecoding.example' : window.location.origin,
): string {
  const roomCode = encodeURIComponent(snapshot.data.roomCode)
  return `<iframe src="${origin}/embed/${roomCode}?revision=${snapshot.revision}" title="${snapshot.data.title} 결과 대시보드" width="100%" height="720" loading="lazy" style="border:0;border-radius:24px"></iframe>`
}
