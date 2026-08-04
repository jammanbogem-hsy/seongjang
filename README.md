# VibeCoding Hackathon

해커톤의 시작부터 개인 작품 전시와 데이터 재사용까지 한 흐름으로 연결하는 반응형 웹 프로토타입입니다.

주최자는 슬라이드와 타이머를 제어하고, 참여자는 닉네임과 4자리 PIN으로 입장해 단계별 개인 답변과 최종 작품을 제출합니다. 공개 시점 이후에는 서로의 답변에 댓글을 남길 수 있으며, 주최자는 모든 입력을 정리 세션에서 테마·하이라이트·요약으로 수합합니다. 발행된 결과는 읽기 전용 대시보드, iframe, JSON, CSV, Markdown과 행사 README로 재사용할 수 있습니다.

## 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://127.0.0.1:5173`을 엽니다. 큐레이션된 데모 방 코드는 `VIBE26`입니다.

품질 검사는 아래 명령으로 실행합니다.

```bash
npm run lint
npm run test
npm run build
```

## 주요 데모 경로

- `/` — 서비스 소개와 역할 선택
- `/join/VIBE26` — 닉네임·PIN 등록/재입장
- `/events/room-vibe26/live` — 참여자 라이브 질문·답변·댓글
- `/events/room-vibe26/submission` — 개인 최종 작품 제출
- `/admin/events/room-vibe26/control` — 주최자 라이브 콘솔
- `/admin/events/room-vibe26/participants` — 참여자와 PIN 확인 UX
- `/admin/events/room-vibe26/synthesis` — 단계별 답변 정리와 공개 리비전 발행
- `/admin/events/room-vibe26/portability` — iframe/JSON/CSV/Markdown/README
- `/dashboards/vibecoding-2026` — 공개 수합 대시보드
- `/exhibitions/vibecoding-2026` — 개인 작품 전시

주최자 콘솔의 `참여자 화면` 버튼을 새 탭으로 열면 `BroadcastChannel`을 통한 슬라이드·타이머·공개 상태 동기화를 확인할 수 있습니다.

## 프로토타입 구조

- React + TypeScript + Vite
- Material Design 3에서 영감을 받은 토큰 기반 UI와 Material Symbols
- 반응형 주최자 콘솔, 집중형 참여자 화면, 공개 전시 레이아웃
- `localStorage` 영속 상태 + `sessionStorage` 탭별 참여자 + `BroadcastChannel` 탭 동기화
- 명령 기반 도메인 전이와 단일 공개 projection
- 불변 `publishedSnapshot`에서 모든 공개 화면과 내보내기 생성
- 레퍼런스 고양이를 바탕으로 제작한 픽셀 삽화 에셋

## 공개 데이터 원칙

공개 projection은 내부 객체를 그대로 복사하지 않고 허용된 필드만 다시 구성합니다. PIN, 관리자 이메일, 참여자 내부 ID, 비공개 답변과 접속 정보는 대시보드나 내보내기에 포함되지 않습니다. JSON, CSV, Markdown, README와 iframe은 모두 동일한 발행 리비전을 사용합니다.

## Firebase 연결

Firebase CLI의 기본 프로젝트는 `.firebaserc`에서 `vibecoding-a3ada`로 연결되어 있습니다. `firebase.json`은 Vite의 `dist` 디렉터리를 SPA 형태로 호스팅하도록 구성했습니다.

```bash
npm run build
firebase deploy --only hosting
```

배포 명령은 외부 공개 작업이므로 이 저장소 생성 과정에서는 실행하지 않았습니다.

## 운영판에서 교체할 부분

현재 버전은 제품 흐름을 검증하는 로컬 프로토타입입니다. 다음 운영 단계에서는 아래 기능을 Firebase 서버 구성으로 교체해야 합니다.

- Google/Firebase Authentication과 관리자 이메일 초대
- PIN KDF/KMS 암호화, 재인증, 로그인 rate limit과 감사 로그
- Firestore/Realtime Database 기반 다중 기기 동기화와 서버 기준 마감
- 100명 정원 transaction, Security Rules와 App Check
- Storage MIME 검사, 이미지 메타데이터 제거와 공개 projection
- 실제 공개 API, iframe origin/CSP 정책과 ZIP 무결성 검증

## 이미지 에셋

투명 배경 고양이 삽화는 `public/assets/illustrations/`에, 추가 레트로 고양이 삽화는 `public/assets/retro/`에 있습니다. 원본 레퍼런스는 `design/references/cat-mascot-reference.png`에 보존되어 있습니다.
