/**
 * 인천공항 출국장 혼잡도 — Cloudflare Worker 프록시
 *
 * 이 프록시가 하는 일 3가지
 *   1) 인증키를 서버에 숨긴다        (브라우저에 키가 절대 안 나감)
 *   2) CORS 헤더를 붙인다            (data.go.kr은 안 붙여줘서 브라우저 fetch가 막힘)
 *   3) 90초 캐시                     (일일 트래픽 1000건 한도를 안 넘기게)
 *
 * ─ 트래픽 계산 ─
 *   하루 86,400초 ÷ 1,000건 = 86.4초에 1번이 한계.
 *   90초 캐시면 하루 최대 960건. 사용자가 1만 명이 봐도 호출 수는 그대로다.
 *   (캐시 없이 1분 폴링하면 1,440건 → 한도 초과로 그날 오후에 죽는다)
 *
 * ─ 배포 ─
 *   1. dash.cloudflare.com → Workers & Pages → Create → Worker
 *   2. 이 파일 내용을 붙여넣고 Deploy
 *   3. Settings → Variables and Secrets → Secret 추가
 *        이름: SERVICE_KEY   값: 공공데이터포털 인증키
 *   4. (권장) Variable 추가
 *        이름: ALLOW_ORIGIN  값: 페이지를 올릴 도메인 (예: https://내사이트.pages.dev)
 *        ※ 로컬 테스트 중에는 * 로 두고, 배포 후 도메인으로 바꾸세요
 */

const API = "https://apis.data.go.kr/B551177/statusOfDepartureCongestion/getDepartureCongestion";
const CACHE_SECONDS = 90;

// Worker 인스턴스 메모리 캐시 (인스턴스마다 별도라 완벽하진 않지만 호출량을 크게 줄여준다)
let memo = { at: 0, payload: null };

export default {
  async fetch(request, env) {
    const origin = env.ALLOW_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const json = (obj, extra = {}) =>
      new Response(JSON.stringify(obj), {
        headers: { ...cors, ...extra, "Content-Type": "application/json; charset=utf-8" }
      });

    if (!env.SERVICE_KEY) {
      return json({ ok: false, error: "SERVICE_KEY 시크릿이 설정되지 않았습니다." }, { "Cache-Control": "no-store" });
    }

    const now = Date.now();
    const age = Math.round((now - memo.at) / 1000);
    if (memo.payload && now - memo.at < CACHE_SECONDS * 1000) {
      return json({ ...memo.payload, cache: "HIT", age }, { "Cache-Control": `public, max-age=${CACHE_SECONDS - age}` });
    }

    // 포털이 주는 키는 보통 URL 인코딩된 상태(%2B, %3D 포함).
    // 이미 인코딩돼 있으면 그대로, 아니면 인코딩해서 붙인다.
    const raw = env.SERVICE_KEY.trim();
    const key = /%[0-9A-Fa-f]{2}/.test(raw) ? raw : encodeURIComponent(raw);

    const url = `${API}?serviceKey=${key}&type=json&numOfRows=100&pageNo=1`;

    let upstream;
    try {
      upstream = await fetch(url, {
        headers: { "Accept": "application/json" },
        cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true }
      });
    } catch (e) {
      // 상류가 죽었을 때 오래된 캐시라도 준다 (빈 화면보다 낫다)
      if (memo.payload) return json({ ...memo.payload, cache: "STALE", age, warning: String(e) });
      return json({ ok: false, error: "공공데이터포털 호출 실패: " + String(e) }, { "Cache-Control": "no-store" });
    }

    const text = await upstream.text();

    // data.go.kr은 오류일 때 JSON을 요청해도 XML을 뱉는 경우가 잦다.
    let data = null;
    try { data = JSON.parse(text); } catch (_) { /* XML일 가능성 */ }

    if (data === null) {
      const codeMatch = text.match(/<returnReasonCode>([^<]+)</i) || text.match(/<resultCode>([^<]+)</i);
      const msgMatch  = text.match(/<returnAuthMsg>([^<]+)</i)   || text.match(/<resultMsg>([^<]+)</i);
      return json({
        ok: false,
        error: "JSON이 아닌 응답을 받았습니다 (대개 인증키 문제).",
        code: codeMatch ? codeMatch[1] : null,
        message: msgMatch ? msgMatch[1] : null,
        rawHead: text.slice(0, 600)
      }, { "Cache-Control": "no-store" });
    }

    const payload = { ok: true, fetchedAt: new Date().toISOString(), data };
    memo = { at: now, payload };

    return json({ ...payload, cache: "MISS", age: 0 }, { "Cache-Control": `public, max-age=${CACHE_SECONDS}` });
  }
};
