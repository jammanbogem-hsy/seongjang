export const EVENT_SLIDES = [
  {
    id: 'stage-discover', order: 1, eyebrow: 'DISCOVER · 12분', title: '오늘 우리가 풀고 싶은 장면은?',
    prompt: '일상에서 자주 반복되지만 아직 매끄럽지 않은 순간을 한 장면으로 적어주세요.',
    helper: '누가, 언제, 어디에서 어떤 불편을 겪는지 구체적으로 써보세요.', durationSec: 720,
    illustration: '/assets/illustrations/cat-ideation.webp', inputFields: [],
  },
  {
    id: 'stage-focus', order: 2, eyebrow: 'FOCUS · 10분', title: '가장 먼저 도울 사용자는 누구인가요?',
    prompt: '한 사람을 떠올리고 그 사람이 지금 하려는 일과 막히는 지점을 적어주세요.',
    helper: '모두를 위한 답보다 첫 번째 사용자의 생생한 맥락에 집중하세요.', durationSec: 600,
    illustration: '/assets/illustrations/cat-lobby.webp', inputFields: [],
  },
  {
    id: 'stage-build', order: 3, eyebrow: 'BUILD · 18분', title: '핵심 경험을 한 문장으로 만든다면?',
    prompt: '사용자가 무엇을 입력하고, 서비스가 무엇을 돌려주며, 어떤 변화가 생기는지 적어주세요.',
    helper: '“사용자가 ___하면, 서비스는 ___해서, ___할 수 있다” 형식을 활용해보세요.', durationSec: 1_080,
    illustration: '/assets/illustrations/cat-timer.webp', inputFields: [],
  },
  {
    id: 'stage-reflect', order: 4, eyebrow: 'REFLECT · 8분', title: '다음 한 번의 실험은 무엇인가요?',
    prompt: '오늘 만든 것에서 가장 먼저 확인할 가설과 바로 이어갈 행동을 적어주세요.',
    helper: '작고 측정 가능하며 내일 시작할 수 있는 행동이면 충분합니다.', durationSec: 480,
    illustration: '/assets/illustrations/cat-submission.webp', inputFields: [],
  },
] as const
