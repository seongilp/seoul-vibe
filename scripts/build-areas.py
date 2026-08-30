#!/usr/bin/env python3
"""
서울시 주요 121장소의 경계/좌표 데이터를 내려받아 앱이 쓰는 두 파일을 만든다.

  public/areas.geojson  지도 폴리곤 (WGS84, 좌표 소수점 5자리)
  lib/areas.ts          장소 메타 + 중심좌표 (사이드바/목록용)

출처: 서울 열린데이터광장 '서울시 실시간 도시데이터' 첨부파일
      https://data.seoul.go.kr/dataList/OA-21778/A/1/datasetView.do

실행:
  python3 scripts/build-areas.py

표준 라이브러리만 쓴다. shapefile 은 폴리곤(shape type 5)만 다루면 충분해서
pyshp/GDAL 없이 직접 파싱한다.
"""

from __future__ import annotations

import io
import json
import struct
import subprocess
import zipfile
from pathlib import Path

DOWNLOAD_URL = "https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?useCache=false"
REFERER = "https://data.seoul.go.kr/dataList/OA-21778/A/1/datasetView.do"
INF_ID = "OA-21778"
AREA_ZIP_SEQ = "16"  # '서울시 주요 121장소 영역.zip'

ROOT = Path(__file__).resolve().parent.parent
GEOJSON_OUT = ROOT / "public" / "areas.geojson"
TS_OUT = ROOT / "lib" / "areas.ts"

COORD_PRECISION = 5  # 약 1m. 이보다 키우면 파일만 커지고 화면상 차이가 없다.


def download(seq: str) -> bytes:
    """
    curl 로 받는다. python.org 배포판은 시스템 CA 번들을 안 쓰는 경우가 많아
    urllib 이 CERTIFICATE_VERIFY_FAILED 로 죽는다. curl 은 어디서나 있다.
    """
    result = subprocess.run(
        [
            "curl", "--silent", "--show-error", "--fail", "--location", "--max-time", "60",
            "-H", f"Referer: {REFERER}",
            "--data", f"infId={INF_ID}&seqNo=&seq={seq}&infSeq=2",
            DOWNLOAD_URL,
        ],
        capture_output=True,
    )
    if result.returncode != 0:
        raise SystemExit(f"다운로드 실패: {result.stderr.decode('utf-8', 'replace').strip()}")
    return result.stdout


def parse_dbf(raw: bytes) -> list[dict[str, str]]:
    record_count, header_len, record_len = struct.unpack("<I H H", raw[4:12])

    fields: list[tuple[str, int]] = []
    cursor = 32
    while raw[cursor] != 0x0D:
        name = raw[cursor : cursor + 11].split(b"\0")[0].decode("utf-8", "replace")
        fields.append((name, raw[cursor + 16]))
        cursor += 32

    records = []
    for index in range(record_count):
        offset = header_len + index * record_len + 1  # 첫 바이트는 삭제 플래그
        row = {}
        for name, length in fields:
            row[name] = raw[offset : offset + length].decode("utf-8", "replace").strip()
            offset += length
        records.append(row)
    return records


def parse_shp_polygons(raw: bytes) -> list[list[list[list[float]]]]:
    """각 레코드를 링 목록(= GeoJSON Polygon 의 coordinates)으로 돌려준다."""
    shapes = []
    cursor = 100  # 파일 헤더
    while cursor < len(raw):
        _, content_len = struct.unpack(">II", raw[cursor : cursor + 8])
        cursor += 8
        body = raw[cursor : cursor + content_len * 2]
        cursor += content_len * 2

        shape_type = struct.unpack("<I", body[0:4])[0]
        if shape_type != 5:  # 5 = Polygon
            shapes.append([])
            continue

        part_count, point_count = struct.unpack("<II", body[36:44])
        parts = list(struct.unpack(f"<{part_count}I", body[44 : 44 + 4 * part_count]))
        parts.append(point_count)

        points_offset = 44 + 4 * part_count
        flat = struct.unpack(
            f"<{point_count * 2}d", body[points_offset : points_offset + 16 * point_count]
        )

        rings = []
        for i in range(part_count):
            start, end = parts[i], parts[i + 1]
            rings.append([[flat[2 * j], flat[2 * j + 1]] for j in range(start, end)])
        shapes.append(rings)
    return shapes


def ring_centroid(ring: list[list[float]]) -> tuple[float, float, float]:
    """폴리곤 무게중심과 면적. 면적 0(퇴화 링)이면 좌표 평균으로 대체한다."""
    area = cx = cy = 0.0
    for i in range(len(ring) - 1):
        x0, y0 = ring[i]
        x1, y1 = ring[i + 1]
        cross = x0 * y1 - x1 * y0
        area += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross

    if area == 0:
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        return sum(xs) / len(xs), sum(ys) / len(ys), 0.0

    area *= 0.5
    return cx / (6 * area), cy / (6 * area), abs(area)


def main() -> None:
    print("내려받는 중: 서울시 주요 121장소 영역.zip")
    archive = zipfile.ZipFile(io.BytesIO(download(AREA_ZIP_SEQ)))

    shp_name = next(n for n in archive.namelist() if n.endswith(".shp"))
    dbf_name = next(n for n in archive.namelist() if n.endswith(".dbf"))

    records = parse_dbf(archive.read(dbf_name))
    shapes = parse_shp_polygons(archive.read(shp_name))
    if len(records) != len(shapes):
        raise SystemExit(f"레코드 수 불일치: dbf {len(records)} vs shp {len(shapes)}")

    features = []
    metas = []
    for record, rings in zip(records, shapes):
        if not rings:
            print(f"  건너뜀(폴리곤 아님): {record.get('AREA_NM')}")
            continue

        largest = max(rings, key=lambda r: ring_centroid(r)[2])
        lon, lat, _ = ring_centroid(largest)

        rounded = [
            [[round(x, COORD_PRECISION), round(y, COORD_PRECISION)] for x, y in ring]
            for ring in rings
        ]
        properties = {
            "cd": record["AREA_CD"],
            "nm": record["AREA_NM"],
            "cat": record["CATEGORY"],
            "lon": round(lon, 6),
            "lat": round(lat, 6),
        }
        features.append(
            {"type": "Feature", "properties": properties, "geometry": {"type": "Polygon", "coordinates": rounded}}
        )
        metas.append(properties)

    GEOJSON_OUT.write_text(
        json.dumps(
            {"type": "FeatureCollection", "features": features},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(f"작성: {GEOJSON_OUT.relative_to(ROOT)} ({GEOJSON_OUT.stat().st_size // 1024}KB, {len(features)}개)")

    metas.sort(key=lambda m: m["cd"])
    categories = sorted({m["cat"] for m in metas})

    lines = [
        "// 서울시 주요 121장소. 출처: 서울 열린데이터광장 '서울시 주요 121장소 영역' shapefile (WGS84).",
        "// 좌표는 각 장소 폴리곤의 최대 링 무게중심.",
        "// 이 파일은 생성물이다. 직접 고치지 말고 scripts/build-areas.py 를 다시 실행할 것.",
        "",
        "export type AreaCategory =",
        *[f"  | '{c}'" + (";" if i == len(categories) - 1 else "") for i, c in enumerate(categories)],
        "",
        "export interface Area {",
        "  cd: string;",
        "  nm: string;",
        "  cat: AreaCategory;",
        "  lon: number;",
        "  lat: number;",
        "}",
        "",
        "export const AREAS: Area[] = [",
        *[
            f"  {{ cd: '{m['cd']}', nm: '{m['nm']}', cat: '{m['cat']}', lon: {m['lon']}, lat: {m['lat']} }},"
            for m in metas
        ],
        "];",
        "",
        "export const AREA_BY_CD = new Map(AREAS.map((a) => [a.cd, a]));",
        "export const AREA_BY_NM = new Map(AREAS.map((a) => [a.nm, a]));",
        "",
    ]
    TS_OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"작성: {TS_OUT.relative_to(ROOT)} ({len(metas)}개 장소)")


if __name__ == "__main__":
    main()
