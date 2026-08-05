# VibeCoding Hackathon

해커톤의 시작부터 개인 작품 전시와 데이터 재사용까지 한 흐름으로 연결하는 Firebase 기반 반응형 웹앱입니다.

주최자는 슬라이드 내용을 실시간 편집하고 단계별 타이머 시간을 조절하며, 참여자는 닉네임과 4자리 PIN으로 입장해 단계별 개인 답변과 최종 작품을 제출합니다. 공개 시점 이후에는 서로의 답변에 댓글을 남길 수 있으며, 주최자는 모든 입력을 정리 세션에서 테마·하이라이트·요약으로 수합합니다. 발행된 결과는 읽기 전용 대시보드, iframe, JSON, CSV, Markdown과 행사 README로 재사용할 수 있습니다.

## 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://127.0.0.1:5173`을 엽니다. 운영 배포 주소는 [vibecoding-a3ada.web.app](https://vibecoding-a3ada.web.app)이며 행사 방 코드는 `VIBE26`입니다.

품질 검사는 아래 명령으로 실행합니다.

```bash
npm run lint
npm run test
npm run build
npm run test:rules
npm --prefix functions run check
```

## 주요 경로

- `/` — 해커톤 서비스 소개와 방 입장·운영 진입
- `/ebook` — PDF 원문을 책 넘김 효과로 읽는 강의 원고 온라인 책자
- `/join/VIBE26` — 닉네임·PIN 등록/재입장
- `/events/room-vibe26/live` — 참여자 라이브 질문·답변·댓글
- `/events/room-vibe26/submission` — 개인 최종 작품 제출
- `/admin/events/room-vibe26/control` — 주최자 라이브 콘솔
- `/admin/events/room-vibe26/participants` — 참여자와 PIN 확인 UX
- `/admin/events/room-vibe26/synthesis` — 단계별 답변 정리와 공개 리비전 발행
- `/admin/events/room-vibe26/admins` — Owner의 Google 이메일 관리자 초대·권한 회수
- `/admin/events/room-vibe26/portability` — iframe/JSON/CSV/Markdown/README
- `/admin/invites/:inviteId` — 초대 링크를 연 동일한 Google 계정의 관리자 권한 수락
- `/dashboards/vibecoding-2026` — 공개 수합 대시보드
- `/exhibitions/vibecoding-2026` — 개인 작품 전시

주최자가 슬라이드의 단계명·제목·질문·도움말을 편집하거나 단계별 타이머(1–180분)·공개 상태를 바꾸면 Cloud Functions가 권한을 검증하고 Firestore를 갱신하며, 연결된 참여자 화면은 실시간 listener로 같은 상태를 받습니다. 슬라이드 텍스트는 0.9초 디바운스로 자동 저장되고 타이머 시간은 슬라이드 기본값으로 유지됩니다.
첫 타이머를 시작하거나 재개하면 신규 닉네임 등록은 서버에서 마감되고, 기존 참여자의 닉네임·4자리 PIN 재입장은 계속 허용됩니다.

## 제품 구조

- React + TypeScript + Vite
- Google Drive의 정보 밀도를 참고한 Material Design 3 UI: Google Sans Flex·Noto Sans KR, Material Symbols, 단일 Google Blue와 절제된 중립색 표면
- 데스크톱 주최자용 좌측 작업공간 내비게이션, 참여자·공개 화면용 상단 내비게이션, 모바일 하단 내비게이션
- 반응형 주최자 콘솔, 집중형 참여자 화면, 공개 전시 레이아웃
- Firebase Authentication: Google 주최자 계정, 이메일 초대 링크와 동일 Google 계정 검증, 익명 사전 인증 후 닉네임·PIN 기반 참여자 custom token
- Cloud Firestore: 서울 `asia-northeast3`, 운영 메모리 캐시, 실시간 listener
- Cloud Functions v2: 참여/재입장, 진행 제어, 제출, 댓글, 비공개 검토, 관리자 초대, 발행, PIN 감사 조회
- 비용 가드: Functions 최대 10 instance·40 concurrent request, 유한 listener, 화면별 공개 shard 로딩
- Firestore Security Rules: 기본 거부, 행사 멤버 역할·Google 로그인 공급자·참여자 소유 초안에 따른 최소 권한
- Firebase App Check: reCAPTCHA Enterprise 권장 위험 기준 `0.5`로 Firestore와 callable Functions 요청 검증
- HMAC 익명화된 인증 세션·기기·IP 계층형 입장 제한과 Firestore TTL 자동 정리
- 신규 닉네임용 6자리 입장 키와 기존 참여자용 4자리 PIN을 분리하고, 민감 인증 함수는 전용 최소권한 서비스 계정에서 실행
- 답변·작품·댓글·검토 작성란·슬라이드 편집·정리 세션 자동저장과 서버 확인 상태
- 답변·작품 draft 리비전의 원자적 증가와 정리 세션 낙관적 잠금으로 다중 기기·다중 관리자 덮어쓰기 방지
- 불변 공개 리비전의 `stages`, `answers`, `comments`, `projects`, `themes` shard에서 대시보드와 전시 구성
- 레퍼런스 고양이를 바탕으로 제작한 픽셀 삽화 에셋

## 공개 데이터 원칙

공개 projection은 내부 문서를 그대로 복사하지 않고 허용된 필드만 다시 구성합니다. PIN, 관리자 이메일, 참여자 내부 ID, 비공개 답변과 접속 정보는 대시보드나 내보내기에 포함되지 않습니다. PIN은 Secret Manager 키로 HMAC 검증 및 AES-256-GCM 암호화되며 평문으로 저장되지 않습니다. 관리자의 PIN 조회는 최근 인증, 조회 사유와 감사 로그를 요구합니다. JSON, CSV, Markdown, README와 iframe은 모두 동일한 발행 리비전을 사용합니다.

## Firebase 연결

Firebase CLI의 기본 프로젝트는 `.firebaserc`에서 `vibecoding-a3ada`로 연결되어 있습니다. Firestore, Functions, Hosting 설정은 `firebase.json`, 보안 정책은 `firestore.rules`, 복합 인덱스는 `firestore.indexes.json`에 있습니다.

```bash
npm run build
firebase deploy --only firestore:rules,firestore:indexes,functions,hosting
```

Functions의 공개 설정은 `functions/.env.vibecoding-a3ada`, PIN 암호화 키는 Firebase Secret Manager의 `PARTICIPANT_SECRET_KEY`에서 관리합니다. 비밀값은 저장소에 포함하지 않습니다.

운영 Functions는 일반 행사 명령과 PIN·입장 인증을 서로 다른 서비스 계정으로 분리합니다. 브라우저 API 키는 두 Firebase Hosting 도메인에서만 사용할 수 있고, 운영 빌드를 로컬에서 열면 실제 데이터 대신 Emulator 연결을 요구합니다. 배포 후에는 `/join/VIBE26`에서 행사 정보와 현재 입장 인원을 확인하고, 주최자 화면에서 신규 입장 키를 전달합니다.

운영 무료 구간, 예산 알림, 과금 위험과 행사 전후 확인사항은 [Firebase 운영 비용 가드](docs/FIREBASE_COSTS.md)에 정리했습니다.

## 운영 행사 상태

`room-vibe26`은 실제 행사 입력을 받기 위한 빈 상태입니다. 화면 확인용 참여자·답변·댓글·작품·공개 리비전은 Firestore에서 제거했고, 이후 초기 생성도 더미 데이터를 만들지 않습니다.

- 소유자 `jammanbogem@gmail.com` 1명
- 참여자 0명 / 최대 100명
- 진행용 슬라이드 4개, 로비·타이머 정지·답변 비공개 상태
- 개인 답변·댓글·검토·작품·테마·관리자 초대 0개
- 공개 대시보드·작품 전시 비공개

## 운영 체크

핵심 제품 흐름은 Firebase에 연결되어 있습니다. 관리자 초대 메일, 초대받은 동일 Google 계정 검증, App Check 강제 적용, 서울 리전 Functions와 입장 요청 제한도 활성화되어 있습니다. 실제 행사 전에는 아래 항목을 현장 조건에 맞춰 확인합니다.

- 100명 동시 입장·자동저장 부하 리허설과 현장 네트워크 대응(Functions 최대 동시 처리 400요청, 정원 서버 검증)
- 작품 이미지 업로드를 열 경우 Storage MIME 검사와 메타데이터 제거
- 외부 iframe 허용 origin, CSP와 내보내기 파일 무결성 정책

## 이미지 에셋

투명 배경 고양이 삽화는 `public/assets/illustrations/`에, 추가 레트로 고양이 삽화는 `public/assets/retro/`에 있습니다. 자동저장·댓글·리뷰·동기화 등 UX 상태를 위해 새로 제작한 10개의 고양이 마스코트는 `public/assets/mascots/`에 있으며, 원본 레퍼런스는 `design/references/cat-mascot-reference.png`에 보존되어 있습니다.
