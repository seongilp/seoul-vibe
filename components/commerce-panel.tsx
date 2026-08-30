'use client';

import { Store } from 'lucide-react';

import {
  CMRCL_LEVELS,
  ageSlices,
  cmrclRank,
  formatAmountRange,
  formatCmrclTime,
  formatMctTime,
  toNumber,
  type RawCmrcl,
  type RawCmrclRsb,
} from '@/lib/commerce';

/**
 * 상권 탭은 인구 혼잡도와 색을 공유하지 않는다.
 * 인구는 여유(초록)~붐빔(빨강) 4색이고 상권은 이 토스 블루 하나로만 칠한다.
 * 두 축을 같은 색으로 칠하면 "빨간 곳 = 붐비고 장사도 잘 되는 곳"처럼 읽히는데,
 * 실제로 두 값은 상관이 없다(명동은 인구 '붐빔'인데 상권 '보통'이다).
 */
const ACCENT = '#3182F6';

interface CommercePanelProps {
  cmrcl: RawCmrcl;
  rsb: RawCmrclRsb[];
}

export function CommercePanel({ cmrcl, rsb }: CommercePanelProps) {
  const level = cmrcl.AREA_CMRCL_LVL?.trim() || null;
  const rank = cmrclRank(level);
  const paymentCnt = toNumber(cmrcl.AREA_SH_PAYMENT_CNT);
  const amount = formatAmountRange(
    toNumber(cmrcl.AREA_SH_PAYMENT_AMT_MIN),
    toNumber(cmrcl.AREA_SH_PAYMENT_AMT_MAX),
  );
  const observedAt = formatCmrclTime(cmrcl.CMRCL_TIME);
  const male = toNumber(cmrcl.CMRCL_MALE_RATE);
  const female = toNumber(cmrcl.CMRCL_FEMALE_RATE);
  const personal = toNumber(cmrcl.CMRCL_PERSONAL_RATE);
  const corporation = toNumber(cmrcl.CMRCL_CORPORATION_RATE);
  const ages = ageSlices(cmrcl);
  const hasAges = ages.some((slice) => slice.rate > 0);

  return (
    <div className="space-y-4">
      <section className="bg-background/40 border-border/60 rounded-lg border p-3">
        <p className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium">
          <Store className="size-4" />
          카드 결제 활발도
        </p>

        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold" style={{ color: ACCENT }}>
            {level ?? '—'}
          </span>
          <LevelMeter rank={rank} />
        </div>

        {/*
          이 4단계는 절대 결제량의 함수가 아니다. 명동은 결제 470건(전체 1위)인데 '보통',
          가락시장은 24건인데 '분주한' 이다. 그 장소의 평소 대비 상대값으로 보인다.
          이 문장을 빼면 화면이 "어디가 더 장사가 잘 되나"로 읽혀서 거짓말이 된다.
        */}
        <p className="text-muted-foreground mt-2 text-[11px] leading-relaxed">
          이 장소의 <b className="text-foreground/80 font-medium">평소 대비</b> 상대적인 수준입니다. 장소끼리
          비교할 수 없습니다.
        </p>

        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <Figure label="결제 건수" value={paymentCnt === null ? '—' : `${paymentCnt.toLocaleString('ko-KR')}건`} />
          {/*
            AREA_SH_PAYMENT_AMT 는 '건당 평균'이 아니라 그 구간의 결제금액 '합계'다.
            명동은 838건에 980~990만원인데 이걸 건당으로 읽으면 총액이 82억이 된다.
            82곳 전부에서 금액/건수가 5천~8만원(중앙값 2.3만원)에 들어오는 것으로 확인했다.
            금액 자체는 구간값이라 '980~990만원' 처럼 범위 그대로 둔다. 중앙값을 만들면
            (구간 폭이 1만/5만/10만원으로 제각각이라) 없는 정밀도가 생긴다.
          */}
          <Figure label="결제 금액 합계" value={amount ?? '—'} />
        </dl>

        {observedAt && <p className="text-muted-foreground mt-2 text-[11px]">{observedAt} 기준</p>}
      </section>

      {hasAges && (
        <section className="bg-background/40 border-border/60 rounded-lg border p-3">
          <p className="text-muted-foreground mb-2 text-xs font-medium">결제자 연령대</p>
          <AgeBars slices={ages} />
        </section>
      )}

      {(male !== null || personal !== null) && (
        <section className="bg-background/40 border-border/60 rounded-lg border p-3 space-y-3">
          <p className="text-muted-foreground text-xs font-medium">결제자 구성</p>
          {male !== null && female !== null && (
            <SplitBar leftLabel="남성" leftRate={male} rightLabel="여성" rightRate={female} />
          )}
          {personal !== null && corporation !== null && (
            <SplitBar leftLabel="개인" leftRate={personal} rightLabel="법인" rightRate={corporation} />
          )}
        </section>
      )}

      {rsb.length > 0 && <RsbList rsb={rsb} />}
    </div>
  );
}

/**
 * 4단계를 색이 아니라 채워진 칸 수로 보여준다.
 * 단계별로 색을 다르게 주면 인구 혼잡도 색상표와 같은 축으로 오해되고,
 * 색맹 사용자에게는 단계 구분 자체가 사라진다.
 */
function LevelMeter({ rank }: { rank: number }) {
  return (
    <span
      className="flex gap-0.5"
      role="img"
      aria-label={rank < 0 ? '활발도 미상' : `${CMRCL_LEVELS.length}단계 중 ${rank + 1}단계`}
    >
      {CMRCL_LEVELS.map((level, index) => (
        <span
          key={level}
          className="h-2.5 w-2 rounded-[2px]"
          style={{ backgroundColor: index <= rank ? ACCENT : 'var(--border)' }}
        />
      ))}
    </span>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-[11px]">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

const BAR_H = 44;
/** 칸 사이 간격(%). 300px 폭에서 약 2px 이 되게 잡았다. */
const BAR_GAP_PCT = 0.6;

/**
 * 연령대 6칸 인라인 SVG. 단일 계열이라 막대 색은 전부 같고 범례도 두지 않는다.
 * 값을 6개 전부 찍으면 숫자밭이 되므로 가장 큰 칸에만 직접 라벨을 붙이고
 * 나머지는 <title> 로 넘긴다.
 *
 * viewBox 로 가로를 늘리지 않는다. preserveAspectRatio="none" 으로 늘리면
 * 모서리 라운딩까지 같이 찌그러져서 칸마다 다른 모양이 된다. 대신 x/width 를 % 로 준다.
 */
function AgeBars({ slices }: { slices: { label: string; rate: number }[] }) {
  const max = Math.max(...slices.map((slice) => slice.rate), 1);
  const topIndex = slices.reduce((best, slice, i) => (slice.rate > slices[best].rate ? i : best), 0);
  const slotPct = 100 / slices.length;

  return (
    <div>
      <svg
        width="100%"
        height={BAR_H}
        className="block"
        role="img"
        aria-label={slices.map((slice) => `${slice.label} ${Math.round(slice.rate)}%`).join(', ')}
      >
        {slices.map((slice, index) => {
          // 0% 도 바닥에 2px 은 남겨서 '칸이 통째로 없다'와 '값이 0이다'를 구분한다.
          const height = Math.max(2, (slice.rate / max) * BAR_H);
          return (
            <rect
              key={slice.label}
              x={`${index * slotPct + BAR_GAP_PCT / 2}%`}
              y={BAR_H - height}
              width={`${slotPct - BAR_GAP_PCT}%`}
              height={height}
              rx={2}
              fill={ACCENT}
              opacity={slice.rate > 0 ? 1 : 0.25}
            >
              <title>{`${slice.label} ${Number(slice.rate.toFixed(1))}%`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex">
        {slices.map((slice, index) => (
          <span
            key={slice.label}
            className={`flex-1 text-center text-[10px] tabular-nums ${
              index === topIndex ? 'text-foreground font-semibold' : 'text-muted-foreground'
            }`}
          >
            {slice.label.replace('대', '')}
            {index === topIndex && (
              <b className="block font-semibold" style={{ color: ACCENT }}>
                {Math.round(slice.rate)}%
              </b>
            )}
          </span>
        ))}
      </div>
      <p className="text-muted-foreground mt-1 text-[10px]">단위: 대 (10~60대)</p>
    </div>
  );
}

/**
 * 두 값의 비율. 색을 두 개 쓰지 않고 액센트 + 트랙으로 나누고, 양쪽 다 글자로 라벨을 붙인다.
 * 색만으로 남/여를 구분하게 만들면 흑백·색맹 환경에서 읽을 수 없다.
 */
function SplitBar({
  leftLabel,
  leftRate,
  rightLabel,
  rightRate,
}: {
  leftLabel: string;
  leftRate: number;
  rightLabel: string;
  rightRate: number;
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px]">
        <span className="tabular-nums" style={{ color: ACCENT }}>
          {leftLabel} {Math.round(leftRate)}%
        </span>
        <span className="text-muted-foreground tabular-nums">
          {rightLabel} {Math.round(rightRate)}%
        </span>
      </div>
      <div className="bg-border h-1.5 overflow-hidden rounded-full">
        <span
          className="block h-full rounded-full"
          style={{ width: `${leftRate}%`, backgroundColor: ACCENT }}
        />
      </div>
    </div>
  );
}

function RsbList({ rsb }: { rsb: RawCmrclRsb[] }) {
  // 가맹점 수 기준 시점은 254건 전부 같은 값이었지만, 다를 가능성에 대비해 첫 값만 라벨로 쓴다.
  const mctTime = formatMctTime(rsb.find((row) => row.RSB_MCT_TIME)?.RSB_MCT_TIME);
  const sorted = [...rsb].sort(
    (a, b) => (toNumber(b.RSB_SH_PAYMENT_CNT) ?? 0) - (toNumber(a.RSB_SH_PAYMENT_CNT) ?? 0),
  );

  return (
    <section className="bg-background/40 border-border/60 rounded-lg border p-3">
      <p className="text-muted-foreground mb-2 text-xs font-medium">업종별 {rsb.length}종</p>
      <ul className="space-y-2.5">
        {sorted.map((row, index) => {
          const cnt = toNumber(row.RSB_SH_PAYMENT_CNT);
          const amount = formatAmountRange(
            toNumber(row.RSB_SH_PAYMENT_AMT_MIN),
            toNumber(row.RSB_SH_PAYMENT_AMT_MAX),
          );
          const mct = toNumber(row.RSB_MCT_CNT);
          return (
            <li key={`${row.RSB_MID_CTGR}-${index}`} className="text-xs">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{row.RSB_MID_CTGR ?? '기타'}</span>
                <LevelMeter rank={cmrclRank(row.RSB_PAYMENT_LVL)} />
                <span className="text-muted-foreground ml-auto shrink-0 text-[11px]">
                  {row.RSB_PAYMENT_LVL ?? '—'}
                </span>
              </div>
              <p className="text-muted-foreground mt-0.5 text-[11px] tabular-nums">
                {row.RSB_LRG_CTGR ?? '기타'} · {cnt === null ? '—' : `${cnt.toLocaleString('ko-KR')}건`}
                {amount ? ` · ${amount}` : ''}
              </p>
              {mct !== null && (
                // 가맹점 수만 월 단위 과거 집계다. 같은 줄에 실시간 값과 섞어두면 전부 실시간으로 읽힌다.
                <p className="text-muted-foreground/70 text-[11px] tabular-nums">
                  가맹점 {mct.toLocaleString('ko-KR')}곳{mctTime ? ` (${mctTime} 기준)` : ''}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
