# 인천공항 출국장 지금

출국장별 대기시간을 보고 **지금 어디로 가야 하는지**를 알려주는 화면.
GitHub Pages + GitHub Actions만 씁니다. 다른 계정도, 서버도 필요 없습니다.

---

## 구조

```
GitHub Actions (10분마다)
   └─ 공공데이터포털 호출 ──> data/latest.json 에 커밋
                                      │
GitHub Pages ─────────────────────────┘
   └─ index.html 이 같은 도메인의 data/latest.json 을 읽음  →  CORS 없음
```

**왜 이렇게 하냐면** — 브라우저에서 `data.go.kr`을 직접 부르면 CORS로 막힙니다.
그렇다고 정적 호스팅엔 서버를 둘 수 없죠. 그래서 **Actions가 미리 받아다 파일로 저장**해두고,
페이지는 자기 도메인의 파일만 읽습니다. 남의 서버를 부르지 않으니 막힐 일이 없습니다.

인증키는 저장소에 안 들어갑니다. **Actions Secret**에만 있습니다.

---

## 설정 (5단계)

### 1. 저장소 만들고 이 파일들 올리기

```
├─ index.html
├─ data/latest.json
├─ scripts/fetch.py
└─ .github/workflows/update.yml
```

### 2. 인증키를 Secret에 넣기

저장소 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

- Name: `SERVICE_KEY`
- Secret: 공공데이터포털 인증키 (인코딩된 키 그대로 넣어도 되고 디코딩된 키도 됩니다)

### 3. Actions에 쓰기 권한 주기

저장소 → **Settings** → **Actions** → **General** → 맨 아래 **Workflow permissions**
→ **Read and write permissions** 선택 → Save

> 이거 안 하면 Actions가 결과를 커밋 못 해서 `403` 으로 실패합니다. 제일 흔한 실수예요.

### 4. Pages 켜기

저장소 → **Settings** → **Pages** → Source: **Deploy from a branch** → `main` / `/ (root)` → Save

몇 분 뒤 `https://아이디.github.io/저장소이름/` 에서 열립니다.

### 5. 한 번 수동 실행

저장소 → **Actions** 탭 → **출국장 혼잡도 갱신** → **Run workflow**

초록 체크가 뜨고 `data/latest.json`이 갱신되면 성공입니다.

---

## 알아두실 것

**갱신 주기는 10분입니다.** 원본 데이터 자체가 10분 단위(`occurtime`이 `155000` 같은 정각 값)로
보여서 이 주기면 충분합니다. 다만 **GitHub cron은 정시에 안 돕니다** — 몇 분에서 십몇 분까지
늦는 게 정상입니다. 초 단위 실시간이 필요하면 `worker.js`(Cloudflare) 방식으로 가야 합니다.

**API 호출량은 하루 약 144회입니다.** 일일 한도 1,000건 안에 넉넉합니다.
보는 사람이 몇 명이든 호출 수는 그대로예요 — 사용자는 파일만 읽으니까요.

**60일 규칙.** 공개 저장소는 60일간 아무 활동이 없으면 스케줄이 자동으로 꺼집니다.
Actions 봇 커밋만으로는 활동으로 안 쳐줄 수 있으니, 가끔 직접 커밋 하나씩 해주세요.
꺼지면 Actions 탭에 다시 켜는 버튼이 뜹니다.

---

## 덤: 데이터가 알아서 쌓입니다

이게 이 방식의 진짜 이득입니다.

```
data/history/2026-08.ndjson
data/history/2026-09.ndjson
```

한 줄에 한 스냅샷씩 계속 누적됩니다. 몇 주만 지나면
**"금요일 오후 6시엔 3번 출국장이 항상 막힌다"** 같은 걸 말할 수 있게 됩니다.

지금 공개된 API는 **현재 시점만** 줍니다. 과거 데이터는 아무도 안 갖고 있어요.
그래서 이 파일들이 시간이 갈수록 이 화면의 유일한 자산이 됩니다.
남들이 못 하는 말을 하려면 이게 필요합니다.

용량은 걱정 안 하셔도 됩니다. 한 줄에 1KB 남짓이라 1년 모아도 5MB 수준입니다.

---

## 화면이 하는 판단 하나

**1번·6번 출국장은 추천에서 뺍니다.**

대기시간이 6분으로 제일 짧게 찍히지만, `operatingTime`이 빈 값이고 `waitLength`도 0명입니다.
줄이 짧은 게 아니라 **닫혀 있을 가능성**이 큽니다.
그대로 "제일 빠릅니다" 라고 안내하면 사용자를 닫힌 문 앞에 세우게 됩니다.

`ingest()` 안의 이 한 줄이 그 판단입니다.

```js
g.trusted = !!g.op || total > 0;   // 운영시간 없고 0명이면 열렸다고 믿지 않는다
```

며칠 데이터를 쌓아보고 1번·6번이 특정 시간대에 실제로 열리는 게 확인되면 이 규칙을 고치세요.

---

## 고칠 만한 값

`index.html` 맨 위:

```js
var STEPS = [10, 20, 30];   // 여유 / 보통 / 혼잡 경계 (분)
```

지금은 감으로 잡은 값입니다. `data/history/`가 쌓이면 실제 분포를 보고 맞추세요.

---

## 파일

| 파일 | 역할 |
|---|---|
| `index.html` | 화면 전체. 의존성 없는 단일 파일 |
| `scripts/fetch.py` | API 호출 → `data/` 저장. 파이썬 기본 기능만 사용 |
| `.github/workflows/update.yml` | 10분마다 위 스크립트 실행 후 커밋 |
| `data/latest.json` | 화면이 읽는 최신 데이터 |
| `data/history/*.ndjson` | 누적 시계열 (자동 생성) |
| `worker.js` | (선택) 진짜 실시간이 필요할 때 쓰는 Cloudflare Worker |
