# 다회성 세션 아키텍처

VibeCoding은 한 행사의 상태를 덮어쓰는 1회성 앱이 아니다. 주최자가 `/admin/sessions`에서 세션을 만들 때마다 6자리 방 코드, 독립 `eventId`, 공개 `publicSlug`가 새로 생성된다.

## 세션 단위 데이터

`ABC123` 방을 생성한 경우 행사 ID는 `session-abc123`, 공개 slug는 `abc123`이다.

```text
events/session-abc123
├─ members/{uid}                # Owner·관리자·참여자 권한
├─ participants/{participantId}# 닉네임·접속 상태
├─ slides/{slideId}            # 질문·시간·공개 상태
├─ live/state                  # 현재 페이지·타이머
├─ liveReactions/{slide__uid}  # 현재 단계 참여자별 단일 반응
├─ liveChatMessages/{messageId}# 진행 중 청중 채팅
├─ answers/{answerId}          # 개인 단계별 답변
├─ discussionComments/{commentId} # 공개 후 댓글
├─ submissions/{participantId}# 개인 최종 작품
├─ reviewThreads/{threadId}    # 주최자 검토·답글
└─ synthesis/current           # 정리 세션 초안

participantSecrets/session-abc123/members/{participantId} # 암호화 PIN
roomCodes/ABC123                                      # 방 코드 해석
publicEvents/abc123                                   # 읽기 전용 공개 projection
users/{uid}/memberships/session-abc123                # 사용자별 세션 디렉터리
```

답변, 반응, 채팅, 댓글, 작품, 슬라이드, PIN, 공개 리비전은 모두 `eventId`를 경계로 저장한다. 다른 세션의 문서를 재사용하거나 기존 행사 데이터를 덮어쓰지 않는다. 라이브 반응과 채팅 listener는 현재 슬라이드만 구독하며 페이지 전환 시 이전 listener를 해제한다.

## 생명주기

1. Owner가 세션을 생성하면 유일한 방 코드와 빈 첫 슬라이드가 생성된다.
2. 참여자는 해당 방 코드에서만 닉네임·4자리 개인 입장코드를 만들고, 재접속할 때 같은 조합으로 세션 내 개인 자료를 이어간다.
3. 주최자가 공개하면 해당 세션의 정제된 데이터만 `publicEvents/{publicSlug}`에 불변 리비전으로 발행된다.
4. 세션을 종료하면 참여자 멤버십을 비활성화하여 접속을 끝내지만, 기록과 공개 결과는 세션 카드에 보존한다.
5. 다음 행사는 새 세션으로 생성하며, 이전 세션과 같은 사용자가 참여해도 데이터는 섞이지 않는다.

## 레거시 행사

`room-vibe26` / `VIBE26` / `vibecoding-2026`은 기존 링크를 깨뜨리지 않기 위한 호환 세션으로만 유지한다. 새 세션의 기본값으로 사용하지 않으며, 첫 화면의 대시보드·전시는 입력한 방 코드에 해당하는 세션으로만 이동한다.

## 운영 확장 원칙

- 세션 생성과 권한 부여는 Cloud Functions 트랜잭션으로 처리한다.
- 보안 규칙과 Functions 명령은 항상 요청의 `eventId`와 해당 행사 멤버십을 같이 검증한다.
- 공개 화면은 내부 컬렉션을 직접 읽지 않고 세션별 공개 projection만 읽는다.
- 라이브 반응과 채팅은 활성 멤버만 읽고 callable Functions로만 쓴다. 반응은 참여자당 단계별 한 문서, 채팅은 280자·단계별 30개·1.5초 간격으로 제한하며 공개 projection에는 포함하지 않는다.
- 같은 작품은 새 공개 리비전을 발행해도 세션 내부 공개 키가 유지되어 공유한 전시 상세 링크가 바뀌지 않는다. 다른 세션에서는 서로 다른 키를 사용한다.
- 주최자 세션 디렉터리는 본인이 Owner 또는 관리자인 세션만 노출한다. 디렉터리가 열린 동안에는 접근 가능한 행사 문서만 한 개씩 구독해 참여자 수와 진행·종료 상태를 실시간 반영하고, 화면을 닫으면 모두 해제한다.
- 세션 수가 많아지면 `ended` 세션 페이지네이션과 보존 기간·내보내기 정책을 추가한다. 답변·댓글 같은 대용량 실시간 리스너는 현재 열린 단일 세션 화면에만 유지한다.
