export const SEED_TIME = '2026-08-04T09:00:00.000Z'
export const ACCENTS = ['#3157C8', '#EE7658', '#28A37A', '#7657C9', '#1D8298', '#B85C93']

export const PARTICIPANT_NAMES = [
  '구름', '다온', '라온', '마루', '모아', '바다', '보름', '새봄', '소담', '수수', '아람', '여울',
  '오름', '유자', '이든', '자두', '초록', '키위', '토리', '푸름', '하루', '해솔', '호두', '희망',
] as const

export const SEED_SLIDES = [
  {
    id: 'stage-discover', order: 1, eyebrow: 'DISCOVER · 12분', title: '오늘 우리가 풀고 싶은 장면은?',
    prompt: '일상에서 자주 반복되지만 아직 매끄럽지 않은 순간을 한 장면으로 적어주세요.',
    helper: '누가, 언제, 어디에서 어떤 불편을 겪는지 구체적으로 써보세요.', durationSec: 720,
    illustration: '/assets/illustrations/cat-ideation.webp', answersRevealed: true, commentsEnabled: true,
  },
  {
    id: 'stage-focus', order: 2, eyebrow: 'FOCUS · 10분', title: '가장 먼저 도울 사용자는 누구인가요?',
    prompt: '한 사람을 떠올리고 그 사람이 지금 하려는 일과 막히는 지점을 적어주세요.',
    helper: '모두를 위한 답보다 첫 번째 사용자의 생생한 맥락에 집중하세요.', durationSec: 600,
    illustration: '/assets/illustrations/cat-lobby.webp', answersRevealed: true, commentsEnabled: false,
  },
  {
    id: 'stage-build', order: 3, eyebrow: 'BUILD · 18분', title: '핵심 경험을 한 문장으로 만든다면?',
    prompt: '사용자가 무엇을 입력하고, 서비스가 무엇을 돌려주며, 어떤 변화가 생기는지 적어주세요.',
    helper: '“사용자가 ___하면, 서비스는 ___해서, ___할 수 있다” 형식을 활용해보세요.', durationSec: 1_080,
    illustration: '/assets/illustrations/cat-timer.webp', answersRevealed: true, commentsEnabled: true,
  },
  {
    id: 'stage-reflect', order: 4, eyebrow: 'REFLECT · 8분', title: '다음 한 번의 실험은 무엇인가요?',
    prompt: '오늘 만든 것에서 가장 먼저 확인할 가설과 바로 이어갈 행동을 적어주세요.',
    helper: '작고 측정 가능하며 내일 시작할 수 있는 행동이면 충분합니다.', durationSec: 480,
    illustration: '/assets/illustrations/cat-submission.webp', answersRevealed: false, commentsEnabled: false,
  },
] as const

export const ANSWER_SEEDS = [
  ['participant-01', 'stage-discover', '행사에서 좋은 아이디어가 나와도 메모가 흩어져 다음 행사에서 다시 시작하게 됩니다.'],
  ['participant-02', 'stage-discover', '처음 만난 팀원이 서로의 관심사와 가능한 역할을 알아가는 데 시간이 오래 걸립니다.'],
  ['participant-03', 'stage-discover', '발표가 끝난 뒤 피드백이 말로만 남아 무엇부터 고칠지 결정하기 어렵습니다.'],
  ['participant-04', 'stage-discover', '짧은 해커톤에서 진행 상황을 묻는 체크인이 몰입을 자주 끊습니다.'],
  ['participant-05', 'stage-discover', '아이디어가 많은 참가자가 조용한 참가자의 의견을 놓치기 쉽습니다.'],
  ['participant-06', 'stage-focus', '행사 경험이 적고 질문을 어디서 해야 할지 모르는 첫 참가자를 돕고 싶습니다.'],
  ['participant-07', 'stage-focus', '여러 팀을 동시에 돌보는 운영자가 막힌 팀을 빠르게 발견하도록 돕고 싶어요.'],
  ['participant-08', 'stage-focus', '개인으로 참여해 아이디어를 끝까지 작품으로 만들어야 하는 사람에게 집중합니다.'],
  ['participant-09', 'stage-focus', '발표 직전 자신의 과정을 짧게 정리해야 하는 참가자가 첫 사용자입니다.'],
  ['participant-10', 'stage-build', '참가자가 단계별 질문에 답하면 서비스는 흔한 키워드를 묶어 팀 전체의 지도를 보여줍니다.'],
  ['participant-11', 'stage-build', '운영자가 페이지를 넘기면 모두의 화면이 따라가고 남은 시간이 한눈에 보입니다.'],
  ['participant-12', 'stage-build', '개인의 메모를 자동으로 전시 카드와 README 초안으로 바꿔 결과물을 공유하게 합니다.'],
  ['participant-13', 'stage-build', '공개 시점을 운영자가 정하면 서로의 답을 읽고 맥락이 남는 댓글을 주고받습니다.'],
  ['participant-14', 'stage-build', '지난 행사의 데이터를 표준 JSON으로 내보내 다음 워크숍이 그대로 이어받게 합니다.'],
  ['participant-15', 'stage-reflect', '다섯 명에게 결과 페이지를 보여주고 30초 안에 행사 흐름을 이해하는지 확인하겠습니다.'],
  ['participant-16', 'stage-reflect', '모바일에서 답변 작성부터 제출까지 막힘이 없는지 실제 기기로 테스트합니다.'],
  ['participant-17', 'stage-reflect', '운영자 한 명이 100명의 상태를 놓치지 않는지 리허설로 검증하겠습니다.'],
  ['participant-18', 'stage-reflect', '공개 데이터에 개인 정보가 섞이지 않는지 내보내기 파일을 먼저 점검합니다.'],
] as const

export const COMMENT_SEEDS = [
  ['comment-01', 'participant-19', 'answer-01', '다음 행사에서 바로 이어 쓸 수 있다는 점이 특히 좋아요. 표준 포맷이 궁금합니다.', '2026-08-04T10:32:00.000Z'],
  ['comment-02', 'participant-20', 'answer-03', '피드백을 중요도와 실행 난이도로 나눠주면 더 결정하기 쉬울 것 같아요.', '2026-08-04T10:35:00.000Z'],
  ['comment-03', 'participant-21', 'answer-12', 'README가 결과물뿐 아니라 과정의 질문과 답까지 연결해주면 좋겠습니다.', '2026-08-04T11:04:00.000Z'],
  ['comment-04', 'participant-22', 'answer-13', '댓글 공개 범위를 행사 참가자로 한정하는 옵션도 있으면 안심될 것 같아요.', '2026-08-04T11:08:00.000Z'],
] as const

export const SUBMISSION_SEEDS = [
  ['participant-02', '흐름이', '흩어진 해커톤의 순간을 하나의 이야기로 잇는 진행 도우미', '단계별 질문, 라이브 진행, 회고 기록을 한 흐름에 모아 처음 온 참가자도 길을 잃지 않게 합니다.', 'https://example.com/flowy', 'https://github.com/example/flowy', ['진행', '온보딩', '아카이빙'], '기능보다 다음 행동이 명확한 질문 한 줄이 더 중요하다는 것을 배웠습니다.', '/assets/illustrations/cat-lobby.webp'],
  ['participant-05', '조용한 마이크', '모든 사람의 아이디어가 같은 크기로 보이는 익명 브레인스토밍 보드', '발언 순서나 목소리 크기에 관계없이 개인 답변을 모으고 공개 시점에 한꺼번에 펼칩니다.', 'https://example.com/quiet-mic', '', ['포용성', '브레인스토밍'], '익명성과 맥락 사이의 균형을 참가자가 직접 선택하도록 설계하고 싶습니다.', '/assets/illustrations/cat-ideation.webp'],
  ['participant-08', 'README 정원사', '만드는 동안 남긴 메모로 프로젝트 소개를 키워주는 작은 편집자', '질문에 답한 기록과 링크를 조합해 전시 카드, 회고, README를 동시에 만듭니다.', 'https://example.com/readme-gardener', 'https://github.com/example/readme-gardener', ['README', '개인제출', '전시'], '완성 후 문서를 쓰게 하지 말고 만드는 과정에서 자연스럽게 모아야 했습니다.', '/assets/illustrations/cat-submission.webp'],
  ['participant-11', '같은 페이지', '진행자의 리듬을 모든 화면에 전달하는 동기화 슬라이드', '슬라이드, 타이머, 공개 상태를 실시간으로 맞춰 현장과 온라인 참가자가 같은 장면을 봅니다.', 'https://example.com/same-page', 'https://github.com/example/same-page', ['실시간', '슬라이드', '타이머'], '시간 자체보다 시작·멈춤·재개의 기준을 한 곳에 두는 것이 핵심이었습니다.', '/assets/illustrations/cat-timer.webp'],
  ['participant-14', '행사 릴레이', '한 행사에서 얻은 배움을 다음 행사로 넘기는 포터블 데이터 키트', '개인 정보를 덜어낸 결과를 JSON, CSV, Markdown으로 내보내 다른 도구가 이어받게 합니다.', '', 'https://github.com/example/event-relay', ['데이터', '내보내기', '재사용'], '내보내기 형식이 여러 개여도 공개 원본은 하나여야 신뢰할 수 있습니다.', '/assets/illustrations/cat-exhibition.webp'],
  ['participant-17', '백 명의 온도', '100명 안의 몰입과 막힘을 한눈에 읽는 운영 대시보드', '참여, 응답, 제출 신호를 간결하게 모아 운영자가 개입할 순간을 놓치지 않게 합니다.', 'https://example.com/room-temperature', '', ['운영', '대시보드', '100명'], '숫자를 많이 보여주기보다 지금 도움이 필요한 사람을 드러내는 데 집중했습니다.', '/assets/illustrations/cat-exhibition.webp'],
] as const

export const REVIEW_SEEDS = [
  {
    id: 'review-thread-01', targetType: 'answer', targetId: 'answer-17', participantUid: 'participant-17',
    field: '단계 답변', quote: '100명의 상태를 놓치지 않는지 리허설로 검증하겠습니다.', status: 'open',
    createdAt: '2026-08-04T11:30:00.000Z', updatedAt: '2026-08-04T11:30:00.000Z', resolvedAt: null,
    messages: [['review-message-01', 'organizer', null, '리허설에서 확인할 성공 기준을 숫자로 한 가지 더 적어보면 실험이 선명해질 것 같아요.', '2026-08-04T11:30:00.000Z']],
  },
  {
    id: 'review-thread-02', targetType: 'submission', targetId: 'submission-01', participantUid: 'participant-02',
    field: '상세 설명', quote: '처음 온 참가자도 길을 잃지 않게 합니다.', status: 'resolved',
    createdAt: '2026-08-04T11:36:00.000Z', updatedAt: '2026-08-04T11:48:00.000Z', resolvedAt: '2026-08-04T11:52:00.000Z',
    messages: [
      ['review-message-02', 'organizer', null, '첫 참가자가 가장 먼저 보게 되는 화면을 한 문장으로 덧붙여주세요.', '2026-08-04T11:36:00.000Z'],
      ['review-message-03', 'participant', 'participant-02', '온보딩 첫 화면의 단계 안내를 상세 설명에 반영했습니다.', '2026-08-04T11:48:00.000Z'],
    ],
  },
] as const

export const THEME_SEEDS = [
  ['theme-shared-flow', '같은 흐름', '진행 상태와 다음 행동을 모두에게 명확하게 전달합니다.', '#3157C8', ['answer-04', 'answer-11', 'answer-17']],
  ['theme-quiet-voices', '모든 목소리', '참여 방식과 성향에 관계없이 개인의 생각을 안전하게 모읍니다.', '#EE7658', ['answer-02', 'answer-05', 'answer-06', 'answer-13']],
  ['theme-portable-memory', '이어지는 기록', '행사에서 만든 데이터가 문서와 다음 프로그램으로 이어집니다.', '#28A37A', ['answer-01', 'answer-12', 'answer-14', 'answer-18']],
] as const

export const ORGANIZER_SUMMARY = '참가자들은 “같은 화면을 보는 진행 경험”, “조용한 목소리까지 모으는 방식”, “다음 행사로 이어지는 기록”을 공통 과제로 발견했습니다. 개인의 답변은 작품과 README로 연결되고, 공개 시점을 분리해 안전하게 서로의 맥락을 읽도록 설계했습니다.'
