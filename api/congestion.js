const API = "https://apis.data.go.kr/B551177/statusOfDepartureCongestion/getDepartureCongestion";

module.exports = async function handler(req, res) {
  const raw = (process.env.SERVICE_KEY || "").trim();

  if (!raw) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({
      ok: false,
      error: "SERVICE_KEY 환경변수가 없습니다.",
      hint: "Vercel > Settings > Environment Variables 에 추가하고 Redeploy 하세요."
    });
  }

  const key = /%[0-9A-Fa-f]{2}/.test(raw) ? raw : encodeURIComponent(raw);
  const url = `${API}?serviceKey=${key}&type=json&numOfRows=100&pageNo=1`;

  try {
    const upstream = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await upstream.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      const code = (text.match(/<returnReasonCode>([^<]+)</i) || text.match(/<resultCode>([^<]+)</i) || [])[1] || null;
      const msg  = (text.match(/<returnAuthMsg>([^<]+)</i)   || text.match(/<resultMsg>([^<]+)</i)   || [])[1] || null;
      res.setHeader("Cache-Control", "no-store");
      return res.status(502).json({
        ok: false,
        error: "JSON이 아닌 응답 (대개 인증키 문제).",
        code, message: msg, rawHead: text.slice(0, 500)
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

    res.setHeader("Cache-Control", "public, s-maxage=90, stale-while-revalidate=300");
    return res.status(200).json(data);

  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ ok: false, error: "호출 실패: " + String(e) });
  }
};
