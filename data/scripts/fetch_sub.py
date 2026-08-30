"""121장소 citydata 에서 SUB_STTS(역 좌표) 와 LIVE_SUB_PPLTN 을 뽑는다."""
import json, os, re, sys, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
KEY = os.environ["SEOUL"]
src = open(os.path.join(ROOT, "lib", "areas.ts"), encoding="utf-8").read()
AREAS = re.findall(r"\{ cd: '([^']+)', nm: '([^']+)'", src)

def fetch(item):
    cd, nm = item
    url = f"http://openapi.seoul.go.kr:8088/{KEY}/json/citydata/1/5/{urllib.parse.quote(nm)}"
    try:
        body = json.loads(urllib.request.urlopen(url, timeout=90).read())
    except Exception as e:
        return {"cd": cd, "nm": nm, "error": str(e)}
    c = (body.get("CITYDATA") or {})
    subs = []
    for s in (c.get("SUB_STTS") or []):
        subs.append({k: s.get(k) for k in
                     ("SUB_STN_NM", "SUB_STN_LINE", "SUB_STN_X", "SUB_STN_Y", "SUB_STN_RADDR")})
    return {"cd": cd, "nm": nm, "sub_stts": subs,
            "live_sub_ppltn": c.get("LIVE_SUB_PPLTN"),
            "live_ppltn_time": (c.get("LIVE_PPLTN_STTS") or [{}])[0].get("PPLTN_TIME")}

with ThreadPoolExecutor(max_workers=8) as ex:
    out = list(ex.map(fetch, AREAS))
p = os.path.join(ROOT, "data", "raw", "sub-stts-121.json")
json.dump(out, open(p, "w", encoding="utf-8"), ensure_ascii=False)
print("wrote", p, os.path.getsize(p), file=sys.stderr)
