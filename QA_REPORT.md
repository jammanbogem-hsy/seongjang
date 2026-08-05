# VibeCoding 상호작용 QA 보고서

- 검증일: 2026-08-05
- 대상: 주최자 콘솔, 참여자 라이브/제출, 공개 대시보드/전시
- 현재 출시 판정: **운영 차단(Release blocked)**

## 통과한 흐름

같은 브라우저와 같은 origin의 여러 탭에서 다음 흐름을 실제 UI로 연결해 검증했습니다.

| 흐름 | 결과 |
| --- | --- |
| 신규 닉네임과 PIN 입장, 잘못된 PIN 차단, 올바른 PIN 재입장 | PASS |
| 참여자 입장 수가 주최자 화면에 반영 | PASS |
| 주최자 슬라이드 전환이 참여자 화면에 반영 | PASS |
| 타이머 시작·감소·일시정지 동기화 | PASS |
| 개인 답변 제출과 주최자 수합 수치 반영 | PASS |
| 답변 공개, 댓글 열기, 댓글 작성과 집계 반영 | PASS |
| 개인 작품 제출과 주최자 작품 목록 반영 | PASS |
| 공개 리비전 발행 후 대시보드·전시에 작품 반영 | PASS |
| 관리자 PIN 확인의 30초 표시 UX | PASS(보안은 운영 차단 항목 참조) |
| JSON·CSV·Markdown·README 다운로드 활성화와 iframe 코드 복사 | PASS |
| 비공개 데이터·PIN·관리자 이메일의 공개 projection 제외 | PASS |

## 검증 중 수정한 결함

1. 주최자가 다른 슬라이드로 이동했다 돌아오면 제출 전 답변이 사라지던 문제를 단계별 로컬 초안으로 보존했습니다.
2. 답변 시간이 끝나도 임시 저장이 가능하던 문제를 UI와 도메인 양쪽에서 차단했습니다.
3. 현재 진행 중이 아닌 질문에 대한 늦은 저장을 도메인에서 거부합니다.
4. 실제 메일을 보내지 않는 관리자 초대 알림이 발송 완료처럼 보이지 않도록 수정했습니다.

## 운영 차단 항목

현재 Firebase 연결은 정적 Hosting 설정뿐이며, 행사 데이터는 `localStorage + BroadcastChannel`에 저장됩니다. 따라서 아래 항목은 아직 실패합니다.

| 항목 | 결과 | 필요한 운영 구성 |
| --- | --- | --- |
| 서로 다른 브라우저·프로필·기기 동기화 | FAIL | Firestore/Realtime Database 실시간 구독 |
| 다수 참여자의 동시 답변·댓글·입장 무손실 처리 | FAIL | 문서 분리, transaction/CAS, 서버 검증 |
| 관리자 로그인과 직접 URL 접근 차단 | FAIL | Firebase Auth, 멤버십, Security Rules |
| 관리자 이메일 초대와 권한 수락 | FAIL | Functions/Admin SDK, 초대 토큰, 메일 발송 |
| PIN 안전 저장·재인증·조회 감사 | FAIL | 서버 암호화/KMS, 최근 재인증, rate limit, 감사 로그 |
| 실제 온라인/오프라인 상태 | FAIL | RTDB presence, heartbeat, `onDisconnect` |
| 서버 기준 타이머와 마감 | FAIL | 서버 timestamp/deadline과 쓰기 규칙 |
| 외부 방문자의 공개 대시보드·전시 공유 | FAIL | 서버 저장 공개 snapshot/API |
| 100명 동시 입장 정원 보장 | FAIL | 서버 transaction |

격리 검증에서 `127.0.0.1` origin의 주최자 상태는 25명·신규 작품 1개였지만, `localhost` origin은 독립된 24명 seed와 기존 작품만 표시했습니다. 이는 공개 URL을 다른 사용자에게 전달해도 현재 상태가 공유되지 않는다는 재현 근거입니다.

## 자동 회귀 검증

```text
ESLint: PASS
Vitest: 6 files, 16 tests PASS
Production build: PASS
npm audit --omit=dev --audit-level=high: 0 vulnerabilities
```

실제 출시 전에는 서로 다른 브라우저 프로필과 휴대폰을 사용해 동시 입장, 동시 쓰기, 권한 차단, 공개 snapshot, 오프라인 재연결과 100/101번째 입장 경쟁 조건을 다시 검증해야 합니다.
