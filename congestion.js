/**
 * Vercel 서버리스 함수 — 출국장 혼잡도 프록시
 *
 * 하는 일 3가지
 *   1) 인증키를 서버에만 둔다        (브라우저로 절대 안 나감)
 *   2) CORS 문제를 없앤다            (같은 도메인의 /api/congestion 을 부르게 됨)
 *   3) Vercel CDN에 90초 캐시        (일일 트래픽 1,000건 한도 보호)
 *
 * 배포 후 반드시:
 *   Vercel 프로젝트 → Settings → Environment Variables
 *     Key   : SERVICE_KEY
 *     Value : 공공데이터포털 인증키
 *   저장한 뒤 Deployments 탭에서 Redeploy (환경변수는 재배포해야 반영됩니다)
 */

const API = "https://apis.data.go.kr/B551177/statusOfDepartureCongestion/getDepartureCongestion";

module.exports = async function handler(req, res) {
  const raw = (process.env.SERVICE_KEY || "").trim();

  if (!raw) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({
      ok: false,
      error: "SERVICE_KEY 환경변수가 설정되지 않았습니다.",
      hint: "Vercel → Settings → Environment Variables 에 SERVICE_KEY 를 추가하고 Redeploy 하세요."
    });
  }

  // 포털이 주는 키는 보통 인코딩된 상태(%2B, %3D 포함). 아니면 인코딩해서 붙인다.
  const key = /%[0-9A-Fa-f]{2}/.test(raw) ? raw : encodeURIComponent(raw);
  const url = `${API}?serviceKey=${key}&type=json&numOfRows=100&pageNo=1`;

  try {
    const upstream = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await upstream.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      // data.go.kr은 오류일 때 JSON을 요청해도 XML을 뱉는다
      const code = (text.match(/<returnReasonCode>([^<]+)</i) || text.match(/<resultCode>([^<]+)</i) || [])[1] || null;
      const msg  = (text.match(/<returnAuthMsg>([^<]+)</i)   || text.match(/<resultMsg>([^<]+)</i)   || [])[1] || null;
      res.setHeader("Cache-Control", "no-store");
      return res.status(502).json({
        ok: false,
        error: "JSON이 아닌 응답을 받았습니다 (대개 인증키 문제).",
        code, message: msg,
        rawHead: text.slice(0, 500)
      });
    }

    const header = data && data.response && data.response.header;
    if (header && header.resultCode !== "00") {
      res.setHeader("Cache-Control", "no-store");
      return res.status(502).json({
        ok: false,
        error: "API가 오류를 반환했습니다.",
        code: header.resultCode,
        message: header.resultMsg
      });
    }

    // Vercel CDN이 90초 동안 이 응답을 재사용한다.
    // → 보는 사람이 몇 명이든 공공데이터포털 호출은 90초에 한 번뿐이다.
    res.setHeader("Cache-Control", "public, s-maxage=90, stale-while-revalidate=300");
    return res.status(200).json(data);

  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ ok: false, error: "공공데이터포털 호출 실패: " + String(e) });
  }
};
