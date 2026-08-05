# Firebase 운영 비용 가드

기준일: 2026-08-05, 프로젝트: `vibecoding-a3ada`, 리전: `asia-northeast3`

이 문서는 100명 이하의 바이브코딩 해커톤을 Blaze 요금제에서 안전하게 운영하기 위한 비용 경계와 조치를 기록한다. 단가는 통화·리전·정책에 따라 바뀌므로 공식 요금표를 최종 기준으로 삼는다.

## 현재 보호장치

- 월 10,000원 프로젝트 예산 알림: 실제 사용액 50%, 90%, 100%에서 알림
- Firestore 삭제 보호 활성화, PITR 비활성화
- Functions v2: `minInstances: 0`, `maxInstances: 10`, 인스턴스당 동시성 40, 메모리 256 MiB
- PIN 비밀키는 Secret Manager에 보관하고 모든 callable에 App Check 강제
- Firestore listener에 100명 행사 모델에 맞은 문서 상한 적용
- 전자책은 Firebase와 연결하지 않고, 참여자·입장 화면은 공개 revision shard를 구독하지 않음
- 공개 발행에 15초 재시도 제한, 동일한 답변/댓글 공개 상태는 no-op 처리
- Artifact Registry에 7일 자동 정리 정책 적용
- 고양이 이미지는 새 화면에서 WebP 사용: PNG 약 13.1 MiB에서 WebP 약 0.7 MiB로 전송 후보 축소
- 2.2 MiB PDF는 버전 URL과 1년 브라우저 캐시 적용

## 무료 구간과 경고선

| 항목 | 무료 구간 | 이 제품의 주요 발생 원인 | 운영 판단 |
| --- | ---: | --- | --- |
| Firestore 읽기 | 50,000건/일 | 첫 접속, 실시간 답변·댓글, 재접속 | 행사일에 50%/80% 사용량 알림 권장 |
| Firestore 쓰기 | 20,000건/일 | 초안 자동저장, 댓글, 공개 revision | 비정상 증가 시 신규 입장·댓글 일시 마감 |
| Firestore 삭제 | 20,000건/일 | TTL rate-limit 문서 정리 | TTL 삭제는 무료 사용량에 포함되지 않으나 100명 규모에서는 소액 |
| Firestore 저장소 | 1 GiB | 불변 공개 revision 누적 | 행사 종료 후 보존 리비전 정책 확정 |
| Firestore 아웃바운드 | 10 GiB/월 | 공개 대시보드 열람 | 불변 공개 데이터는 향후 CDN JSON으로 분리 가능 |
| Firebase Hosting 전송 | 10 GB/월 | PDF, 이미지, JS 번들 | 초과 시 $0.15/GB; PDF 약 4,000회 전체 다운로드 근처부터 주의 |
| Hosting 저장소 | 10 GB | 배포 revision 보관 | 초과 시 $0.026/GB; 현재 수십 MiB 수준 |
| reCAPTCHA/App Check | 10,000 assessment/월 | 새 브라우저 세션과 토큰 갱신 | 10,001~100,000은 월 $8, 이후 $1/1,000건 |
| Authentication | 50,000 MAU | 익명 참여자, Google/이메일 관리자 | 100명 행사는 무료 구간. 유료 SMS 인증은 사용하지 않음 |
| Cloud Run functions | 월 2백만 호출 등 무료 할당 | 입장, 제출, 댓글, 공개, PIN 조회 | 인스턴스 상한과 App Check 적용. 리전별 컴퓨트 단가 확인 |

출처:

- <https://firebase.google.com/docs/firestore/pricing>
- <https://firebase.google.com/docs/hosting/usage-quotas-pricing>
- <https://firebase.google.com/pricing>
- <https://firebase.google.com/docs/app-check>
- <https://docs.cloud.google.com/recaptcha/docs/billing-information>
- <https://cloud.google.com/functions/pricing-1stgen>
- <https://docs.cloud.google.com/billing/docs/how-to/budgets>

## 비용이 크게 늘어날 수 있는 순서

1. 공개 대시보드가 외부에서 반복 재접속되면 revision shard 읽기와 Firestore egress가 늘어난다.
2. 주최자가 발행을 반복하면 답변·댓글·작품 전체를 새 불변 revision으로 복사한다. 15초 재시도 제한이 오작동은 막지만, 장기 보존 개수는 행사 정책으로 결정해야 한다.
3. 호출 폭주는 Functions max instance로 속도를 제한하지만, 이것은 금액을 즉시 차단하는 하드캡은 아니다.
4. PDF·이미지 링크가 외부에서 화제가 되면 Hosting 10 GB 월 전송량을 먼저 초과할 수 있다.
5. App Check는 비정상 클라이언트를 줄이지만 정상 앱 세션 내 반복 호출까지 없애지는 않는다.

## 운영 루틴

- 행사 7일 전: 예산 알림 수신자, App Check 지표, Functions max instances 확인
- 행사 당일: Firestore reads/writes와 Hosting transfer를 30분 단위로 확인
- 행사 종료: 전시를 고정한 뒤 불필요한 초안, rate-limit, 오래된 공개 revision 보존 정책 적용
- 매월: Artifact Registry 7일 정리와 Hosting 배포 보존 개수 확인

현재 10,000원 예산은 **알림이지 전체 Firebase 사용을 중지하는 하드캡이 아니다**. Cloud Run functions에는 프리뷰 Spend Cap을 적용할 수 있지만 Firestore·Hosting 저장소 비용까지 모두 중지시키지는 않으며, 발동 시 서비스가 멈춘다. 운영자가 서비스 중단 가능 금액을 결정한 후 적용한다.
