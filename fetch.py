#!/usr/bin/env python3
"""
공공데이터포털에서 출국장 혼잡도를 받아 data/ 에 저장한다.
GitHub Actions가 주기적으로 실행한다. 인증키는 Actions Secret에서 읽는다.

  data/latest.json          최신 1건 (웹페이지가 읽는 파일)
  data/history/YYYY-MM.ndjson   한 줄에 한 스냅샷 — 시계열이 자동으로 쌓인다
"""

import json
import os
import pathlib
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

API = "https://apis.data.go.kr/B551177/statusOfDepartureCongestion/getDepartureCongestion"
ROOT = pathlib.Path(__file__).resolve().parent.parent
KST = timezone(timedelta(hours=9))


def set_output(name: str, value: str) -> None:
    """GitHub Actions 스텝 출력값 기록 (로컬 실행 시엔 아무것도 안 함)."""
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"{name}={value}\n")


def main() -> int:
    raw = (os.environ.get("SERVICE_KEY") or "").strip()
    if not raw:
        print("::error::SERVICE_KEY 시크릿이 비어 있습니다.")
        return 1

    key = raw if "%" in raw else urllib.parse.quote(raw, safe="")
    url = f"{API}?serviceKey={key}&type=json&numOfRows=100&pageNo=1"

    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        text = r.read().decode("utf-8")

    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        print("::error::JSON이 아닌 응답입니다 (대개 인증키 문제).")
        print(text[:500])
        return 1

    header = payload.get("response", {}).get("header", {})
    if header.get("resultCode") != "00":
        print(f"::error::API 오류 {header.get('resultCode')} {header.get('resultMsg')}")
        return 1

    items = payload.get("response", {}).get("body", {}).get("items") or []
    if isinstance(items, dict):
        items = items.get("item") or []
    if not isinstance(items, list) or not items:
        print("::error::항목이 비어 있습니다.")
        return 1

    occur = str(items[0].get("occurtime", ""))
    now = datetime.now(KST)

    latest_path = ROOT / "data" / "latest.json"
    # 원본 데이터의 시각이 그대로면 새로 쓸 이유가 없다 (불필요한 커밋 방지)
    if latest_path.exists():
        try:
            prev = json.loads(latest_path.read_text(encoding="utf-8"))
            prev_items = prev.get("response", {}).get("body", {}).get("items") or []
            if prev_items and str(prev_items[0].get("occurtime", "")) == occur:
                print(f"변화 없음 (occurtime {occur}) — 커밋 생략")
                set_output("changed", "false")
                return 0
        except Exception:
            pass

    payload["fetchedAt"] = now.isoformat()

    latest_path.parent.mkdir(parents=True, exist_ok=True)
    latest_path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")

    hist_dir = ROOT / "data" / "history"
    hist_dir.mkdir(parents=True, exist_ok=True)
    line = json.dumps({"fetchedAt": now.isoformat(), "occurtime": occur, "items": items},
                      ensure_ascii=False, separators=(",", ":"))
    with (hist_dir / f"{now:%Y-%m}.ndjson").open("a", encoding="utf-8") as f:
        f.write(line + "\n")

    print(f"저장 완료 · occurtime {occur} · {len(items)}건")
    set_output("changed", "true")
    return 0


if __name__ == "__main__":
    sys.exit(main())
