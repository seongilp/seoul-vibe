"""121장소 citydata 를 돌며 LIVE_CMRCL_STTS 만 뽑아 모은다. 표준 라이브러리만 사용."""
import json, os, re, sys, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
KEY = os.environ["SEOUL"]
BASE = "http://openapi.seoul.go.kr:8088"

src = open(os.path.join(ROOT, "lib", "areas.ts"), encoding="utf-8").read()
AREAS = re.findall(r"\{ cd: '([^']+)', nm: '([^']+)', cat: '([^']+)'", src)
print(f"areas: {len(AREAS)}", file=sys.stderr)

def fetch(item):
    cd, nm, cat = item
    url = f"{BASE}/{KEY}/json/citydata/1/5/{urllib.parse.quote(nm)}"
    try:
        with urllib.request.urlopen(url, timeout=90) as r:
            raw = r.read()
    except Exception as e:
        return {"cd": cd, "nm": nm, "cat": cat, "error": f"{type(e).__name__}: {e}"}
    try:
        body = json.loads(raw)
    except Exception:
        return {"cd": cd, "nm": nm, "cat": cat, "error": "non-json", "head": raw[:200].decode("utf-8", "replace")}
    res = body.get("RESULT") or {}
    code = res.get("RESULT.CODE") or res.get("CODE")
    if code and code != "INFO-000":
        return {"cd": cd, "nm": nm, "cat": cat, "error": f"{code} {res.get('RESULT.MESSAGE')}"}
    city = body.get("CITYDATA") or {}
    return {
        "cd": cd, "nm": nm, "cat": cat,
        "bytes": len(raw),
        "top_keys": sorted(city.keys()),
        "cmrcl": city.get("LIVE_CMRCL_STTS"),
    }

with ThreadPoolExecutor(max_workers=8) as ex:
    out = list(ex.map(fetch, AREAS))

path = os.path.join(ROOT, "data", "raw", "cmrcl-121.json")
with open(path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)
print("wrote", path, os.path.getsize(path), file=sys.stderr)
