# 서울나우 (Seoul Now)

서울시 주요 **121장소**의 실시간 인구 혼잡도를 지도에 얹고, 장소를 고르면 그곳의
날씨·대기질·도로소통·주차장·따릉이·문화행사를 한 화면에서 보여준다.
서울 열린데이터광장 **실시간 도시데이터** 기반.

![](https://img.shields.io/badge/Next.js-16-black) ![](https://img.shields.io/badge/MapLibre-5-blue)

## 빠르게 실행

```bash
npm install
npm run dev        # http://localhost:3000
```

인증키 없이도 뜬다. 다만 서울시 **샘플키**는 `광화문·덕수궁` 한 곳만 돌려주므로
나머지 120곳은 '미상' 회색으로 표시된다. 헤더에 `샘플키 모드` 배지가 뜬다.

## 전체 121장소를 보려면

1. [서울 열린데이터광장](https://data.seoul.go.kr/together/mypage/actKeyMain.do)에서 인증키를 발급받는다. 무료, 즉시 발급.
2. `.env.local` 을 만든다.

```bash
cp .env.example .env.local
# SEOUL_API_KEY=발급받은키
# SEOUL_API_KEY_2=예비키   (선택)
```

`SEOUL_API_KEY_2` 는 주 키가 일일 트래픽을 초과(`ERROR-337`)하거나 무효(`INFO-100`)일 때만
자동으로 넘어간다. **매 호출 번갈아 쓰지 않는다** — 이 API 는 인증키가 URL 경로에 들어가서
호출마다 키를 바꾸면 Next 의 fetch 캐시가 전부 미스나고 오히려 호출량이 늘어난다.

> data.go.kr 의 '서울특별시_실시간 도시데이터' 는 `LINK` 유형이라 data.go.kr 키가 아니라
> **서울 열린데이터광장 키**가 필요하다. 이 둘은 다른 시스템이다.

## 구조

```
app/
  api/congestion/       121장소 혼잡도 일괄 조회 (citydata_ppltn 팬아웃)
  api/area/[cd]/        장소 1곳 상세 (citydata)
  api/bikes/            따릉이 실시간 대여소 (bikeList)
components/
  dashboard.tsx         상태 보유, 폴링
  map-view.tsx          MapLibre 지도
  area-list.tsx         혼잡한 순 사이드바
  area-detail.tsx       상세 패널
lib/
  seoul.ts              서울 API 클라이언트 (서버 전용)
  areas.ts              121장소 메타 + 중심좌표 (생성물)
public/
  areas.geojson         121장소 폴리곤 (생성물)
scripts/
  build-areas.py        위 두 생성물 재생성
```

### 왜 전부 서버 라우트를 거치나

서울 API 는 `http://openapi.seoul.go.kr:8088` — **평문 HTTP + 비표준 포트**다.
브라우저에서 직접 부르면 https 배포에서 mixed content 로 조용히 차단된다.
게다가 인증키가 클라이언트 번들에 박힌다. 그래서 `lib/seoul.ts` 는 서버에서만 쓴다.

### 캐싱과 API 할당량 (중요)

**혼잡도 갱신 1회 = 서울 API 121콜이다.** 벌크 엔드포인트가 없어서 장소당 한 번씩 불러야 한다.
서울 열린데이터광장 인증키에는 일일 트래픽 상한이 있으므로 폴링 주기가 곧 비용이다.

| 폴링 주기 | 탭 1개 기준 하루 호출 수 |
| --- | --- |
| 3분 | 약 58,000 |
| 5분 | 약 35,000 |
| **10분 (현재 기본값)** | **약 17,000** |
| 30분 | 약 5,800 |

줄이기 위해 넣은 것들:

- 업스트림 `fetch` 에 `revalidate` 300초. 서울시 데이터 자체가 약 5분 주기라 더 자주 불러도
  같은 값만 온다. 여러 클라이언트가 이 캐시를 공유한다.
- **탭이 보이지 않으면 폴링을 멈춘다.** 백그라운드 탭이 조용히 할당량을 태우는 걸 막는다.
- 따릉이는 토글을 켤 때 한 번만 부른다 (2,700여 대여소 = 3콜).

`/api/congestion` 과 `/api/bikes` 는 `force-dynamic` 이다. route handler 에 `revalidate` 만
두면 정적 프리렌더돼서 빌드 타임에 서울 API 를 부르고, 사용자의 새로고침도 CDN 캐시에 막힌다.

> 자기 키의 일일 트래픽은 [마이페이지 인증키 관리](https://data.seoul.go.kr/together/mypage/actKeyMain.do)에서
> 확인할 수 있다. 상한이 낮으면 `POLL_INTERVAL_MS`(`components/dashboard.tsx`)를 늘리거나
> 증량을 신청하는 편이 낫다.

## 데이터 재생성

```bash
python3 scripts/build-areas.py
```

서울 열린데이터광장에서 '서울시 주요 121장소 영역' shapefile 을 받아
`public/areas.geojson` 과 `lib/areas.ts` 를 다시 만든다. 표준 라이브러리 + `curl` 만 쓴다.
장소 목록이 갱신되면(121 → N) 이걸 돌리면 된다.

## Vercel 배포

```bash
npx vercel link
npx vercel env add SEOUL_API_KEY production
npx vercel deploy --prod
```

- `SEOUL_API_KEY` 에 `NEXT_PUBLIC_` 을 붙이지 말 것. 서버에서만 읽는다.
- `/api/congestion` 은 121회 팬아웃이라 `maxDuration = 60` 으로 잡아 뒀다.
  기본 함수 타임아웃(300초) 안이라 추가 설정은 필요 없다.
- 아웃바운드가 평문 HTTP + 8088 포트지만 Vercel 함수에서는 문제없이 나간다.

## 알려진 한계

- **태블릿(768~1023px)**: 장소 목록에 접근할 방법이 없다. 사이드바는 `lg` 이상에서만
  나오고 바텀시트는 `md` 미만에서만 뜬다. 이 구간은 지도로만 조작해야 한다.
- **세로로 긴 화면**: fitBounds 특성상 서울 경계(가로 38km)를 폭에 맞추면
  위아래로 경기도가 남는다. 버그가 아니라 종횡비 때문이다.
- **혼잡도 4단계뿐**: 서울시가 여유/보통/약간 붐빔/붐빔 문자열만 준다. 연속값이 아니다.
- **인구 수치는 추정 범위**: `AREA_PPLTN_MIN`~`MAX` 구간으로만 제공된다.
- 따릉이는 토글을 켤 때 한 번만 불러온다. 자동 갱신하지 않는다.

## 배포 시 주의 — 수동 별칭 함정

`<이름>.vercel.app` 이 **프로젝트 도메인으로 등록돼 있지 않고** `vercel alias set` 으로만
붙어 있으면, 그 별칭은 한 번 꽂고 끝인 포인터라 새 배포를 따라가지 않는다.
`vercel --prod` 가 성공해도 사용자가 보는 주소는 옛 배포에 남는다.

실제로 이 프로젝트에서 두 번 발생했다. 확인:

```bash
vercel alias ls --scope seongilp | grep seoul-vibe.vercel.app
```

최신 배포를 가리키지 않으면 프로젝트 도메인으로 등록한다(1회로 끝난다):

```bash
vercel domains add seoul-vibe.vercel.app seoul-vibe --scope seongilp
```

## 출처

- [서울시 실시간 도시데이터](https://data.seoul.go.kr/dataList/OA-21778/A/1/datasetView.do) — 서울 열린데이터광장
- 베이스맵: [CARTO](https://carto.com/) dark matter, [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
