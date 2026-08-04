# Cat mascot illustrations

웹앱 전반에 사용하는 사용자 제공 고양이 레퍼런스 기반 픽셀 삽화입니다. 모든 최종 에셋은 1254×1254 투명 PNG이며, 캐릭터는 밝은 회색·검정·전기 파랑의 제한 팔레트를 공유합니다.

| 파일 | 권장 화면 |
|---|---|
| `cat-lobby.png` | 방 입장, 로비, 환영 카드 |
| `cat-ideation.png` | 질문 답변, 아이디어 작성, 빈 상태 |
| `cat-timer.png` | 라이브 진행, 제한 시간, 일시정지 |
| `cat-submission.png` | 작품 제출 완료, 저장 성공 |
| `cat-exhibition.png` | 공개 전시, 작품 목록, 아카이브 |

## 사용 규칙

- CSS에 `image-rendering: pixelated`를 적용하고 종횡비를 유지합니다.
- 모바일 표시 폭은 120~180px, 데스크톱은 180~280px를 권장합니다.
- 장식용이면 `alt=""`와 `aria-hidden="true"`를 사용합니다.
- 텍스트나 상태 전달을 이미지에만 의존하지 않습니다.
- 새 변형을 만들 때는 `design/references/cat-mascot-reference.png`를 character anchor로 사용합니다.
- 이미지 내부에는 문구, 숫자, 로고를 넣지 않습니다.

## 공통 생성 프롬프트

```text
Use case: illustration-story
Asset type: web app contextual illustration
Input image: the supplied cat image is the character and pixel-art style anchor.
Preserve the same square light-gray cat, short pointed ears, tiny black square eyes, small black pixel mouth, compact blocky body, and limited black-white-electric-blue palette.
Style: crisp retro pixel art with deliberate chunky square pixels.
Change only the action and minimal props needed for the target screen.
No text, letters, numbers, logos, watermark, border, or extra characters.
```

최종 생성은 Codex 내장 ImageGen을 사용했고, 평면 크로마 배경을 로컬 제거해 알파 PNG로 변환했습니다.
