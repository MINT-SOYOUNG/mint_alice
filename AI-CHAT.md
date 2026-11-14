# AI 프로젝트 상담 도우미 (포트폴리오 챗봇)

포트폴리오 사이트 우측 하단에 붙인 상담 챗봇입니다. 사이트 방문자가
작업 분야·진행 절차·견적 문의 방법을 바로 물어볼 수 있습니다.

## 구성 파일

| 파일 | 역할 |
| --- | --- |
| `api/chat.js` | Vercel 서버리스 함수 (`POST /api/chat`). 키가 있으면 OpenAI 호출, 없거나 실패하면 기본 안내 응답 |
| `js/ai-chat.js` | 위젯 화면 동작(열기/닫기, 빠른 질문, 전송, 서버가 없을 때의 브라우저 폴백) |
| `css/style.css` | 파일 끝에 `.ai-chat-*` 스타일 추가 (민트 `#18bc9c` / 네이비 `#2c3e50`) |
| `index.html` | 위젯 마크업 + `<script src="js/ai-chat.js">` 한 줄 |

`package.json`이나 추가 패키지는 필요 없습니다. Vercel이 `api/` 폴더를 자동으로 함수로 인식합니다.

## 지금 상태

- `OPENAI_API_KEY`가 **없어도** 챗봇은 정상 동작합니다. 이때는 `mode: "fallback"`으로
  작업 범위·진행 절차·견적 안내 문구를 돌려줍니다.
- 키를 등록하면 같은 주소가 곧바로 GPT 응답(`mode: "gpt"`, 기본 모델 `gpt-4o-mini`)으로 바뀝니다.

## OPENAI_API_KEY 등록 (Vercel 대시보드)

1. Vercel → 해당 프로젝트 → **Settings → Environment Variables**
2. **Key** `OPENAI_API_KEY`, **Value** `sk-...` 입력
3. Environments: Production(필요하면 Preview·Development도) 선택 → **Save**
4. **Deployments → 최신 배포 → ⋯ → Redeploy** (환경변수는 재배포해야 반영됩니다)

CLI로 할 경우:

```bash
vercel env add OPENAI_API_KEY production   # 값 입력
vercel --prod                              # 재배포
```

모델을 바꾸고 싶으면 `OPENAI_MODEL` 환경변수를 추가하면 됩니다(기본값 `gpt-4o-mini`).

## 로컬에서 확인하기

```bash
# 1) 화면만 볼 때: /api/chat 이 없으므로 브라우저 폴백으로 답합니다 (키 불필요)
python3 -m http.server 8000

# 2) 서버 함수까지 함께 볼 때 (Vercel CLI 필요)
vercel dev
```

## 주의할 점

- **API 키를 `index.html`이나 `js/`에 넣지 마세요.** 키가 공개됩니다. 서버 환경변수로만 넣습니다.
- 주소가 공개되어 있으므로 함수에 IP 기준 완충 장치(10분에 30회)를 두었습니다. 초과하면 429와 함께
  이메일 문의를 안내합니다.
- 사용한 만큼 OpenAI 계정에 요금이 청구됩니다. 모델별 단가는 OpenAI 가격 페이지를 확인하세요.
- 챗봇은 확인되지 않은 금액·일정을 만들지 않도록 프롬프트에 제한해 두었습니다.
  실제 견적·일정은 상담으로 확정하는 흐름입니다.
