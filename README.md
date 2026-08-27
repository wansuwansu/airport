# 인천공항 출국장 지금

출국장별 대기시간을 보고 **지금 어디로 가야 하는지**를 알려주는 화면.

---

## 구조 (Vercel)

```
브라우저 ──> /api/congestion  ──>  공공데이터포털
             (같은 도메인)         (서버끼리라 CORS 없음)
                   │
                   └─ 인증키는 여기에만. 브라우저로 안 나감
                      Vercel CDN이 90초 캐시 → 호출량 고정
```

**왜 이렇게 하냐면** — 브라우저에서 `data.go.kr`을 직접 부르면 CORS로 막힙니다.
Vercel 서버리스 함수를 한 겹 두면 막히지도 않고 키도 안 새어나갑니다.

---

## 설정 (3단계)

### 1. 저장소를 Vercel에 연결

Vercel → **Add New Project** → 이 저장소 선택 → Framework Preset은 **Other** →
Root Directory는 그대로 두고 Deploy.

빌드 설정은 손댈 게 없습니다. `index.html`은 정적으로, `api/` 폴더는 서버 함수로 자동 인식됩니다.

### 2. 인증키를 환경변수에 넣기

Vercel 프로젝트 → **Settings** → **Environment Variables**

| Key | Value |
|---|---|
| `SERVICE_KEY` | 공공데이터포털 인증키 |

Production / Preview / Development 모두 체크해서 저장하세요.
인코딩된 키(`%2B`, `%3D` 포함)를 그대로 넣어도 되고 디코딩된 키도 됩니다.

### 3. ⚠️ Redeploy

**환경변수는 저장만으로 반영되지 않습니다.**
**Deployments** 탭 → 맨 위 배포의 `···` → **Redeploy** 를 눌러야 적용됩니다.

이걸 안 해서 "SERVICE_KEY 환경변수가 설정되지 않았습니다" 가 계속 뜨는 경우가 제일 흔합니다.

### 확인

브라우저에서 `https://내주소.vercel.app/api/congestion` 을 직접 열어보세요.

| 결과 | 뜻 |
|---|---|
| `{"response":{...}}` | ✅ 성공 |
| `{"ok":false,"error":"SERVICE_KEY 환경변수가..."}` | 3번 Redeploy 안 함 |
| `{"ok":false,"code":"30"}` 등 | 인증키 문제. `message` 를 읽으세요 |
| Vercel 404 페이지 | `api/congestion.js` 가 배포에 안 들어감 |

---

## 화면이 데이터를 가져오는 순서

`index.html`은 `MODE = "auto"` 입니다.

1. `/api/congestion` 을 먼저 시도 → 성공하면 **실시간**
2. 실패하면 `data/latest.json` 으로 자동 전환 → **저장된 파일**

지금 어느 쪽인지는 화면 왼쪽 위 시각 옆에 표시됩니다.
한쪽만 쓰고 싶으면 `MODE` 를 `"proxy"` 또는 `"static"` 으로 바꾸세요.

---

## 덤: GitHub Actions로 과거를 쌓기 (선택)

`.github/workflows/update.yml` 이 10분마다 데이터를 받아 저장소에 커밋합니다.

```
data/latest.json              최신 (서버 함수가 죽었을 때의 대비책)
data/history/2026-08.ndjson   한 줄에 한 스냅샷 — 계속 누적
```

**이게 이 프로젝트의 진짜 자산입니다.**
공개 API는 **현재 시점만** 줍니다. 과거 데이터는 아무도 안 갖고 있어요.
몇 주 쌓이면 이런 말을 할 수 있게 됩니다.

> "금요일 저녁 6시엔 3번이 항상 막힙니다. 5번으로 가세요."

실시간 숫자는 누구나 API로 가져오지만, **누적된 과거는 미리 모아둔 사람만 갖습니다.**

### 쓰려면

1. GitHub → Settings → Secrets and variables → **Actions** → `SERVICE_KEY` 추가
2. GitHub → Settings → Actions → General → **Workflow permissions** → **Read and write** → Save
   (안 하면 커밋 권한이 없어 403으로 실패합니다)
3. Actions 탭 → **출국장 혼잡도 갱신** → Run workflow 로 한 번 수동 실행

커밋 메시지에 `[skip ci]` 를 붙여놨습니다. **Vercel이 10분마다 재배포되는 걸 막는 장치**예요.
이거 없으면 하루 144번 배포되면서 배포 한도를 갉아먹습니다.

안 쓸 거면 `.github/` 폴더를 지우세요. Vercel 함수만으로도 화면은 완전히 동작합니다.

---

## 호출량

| 방식 | 하루 호출 |
|---|---|
| Vercel 함수 (90초 CDN 캐시) | 최대 약 960회 |
| GitHub Actions (10분) | 약 144회 |

일일 한도는 1,000건입니다. **둘 다 켜면 넘칩니다.**
같이 쓰려면 함수 캐시를 늘리거나(`s-maxage=180`) 포털에서 트래픽 증량 신청을 하세요. 무료입니다.

---

## 화면이 하는 판단 하나

**1번·6번 출국장은 추천에서 뺍니다.**

대기시간이 6분으로 제일 짧게 찍히지만 `operatingTime`이 빈 값이고 `waitLength`도 0명입니다.
줄이 짧은 게 아니라 **닫혀 있을 가능성**이 큽니다. 그대로 "제일 빠릅니다"라고 안내하면
사용자를 닫힌 문 앞에 세우게 됩니다.

```js
g.trusted = !!g.op || total > 0;   // 운영시간 없고 0명이면 열렸다고 믿지 않는다
```

며칠 쌓아보고 1번·6번이 특정 시간대에 실제로 열리는 게 확인되면 이 규칙을 고치세요.

---

## 고칠 만한 값

`index.html` 맨 위:

```js
var STEPS = [10, 20, 30];   // 여유 / 보통 / 혼잡 경계 (분)
```

감으로 잡은 값입니다. 데이터가 쌓이면 실제 분포를 보고 맞추세요.

---

## 파일

| 파일 | 역할 |
|---|---|
| `index.html` | 화면 전체. 의존성 없는 단일 파일 |
| `api/congestion.js` | Vercel 서버 함수 — 키 은닉 + CORS 해결 + 90초 캐시 |
| `data/latest.json` | 함수가 죽었을 때의 대비책 |
| `scripts/fetch.py` | (선택) Actions가 실행하는 수집 스크립트 |
| `.github/workflows/update.yml` | (선택) 10분마다 수집 후 커밋 |
| `worker.js` | (선택) Cloudflare를 쓸 경우의 대안. Vercel 쓰면 필요 없습니다 |
