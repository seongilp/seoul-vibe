import type { RawCityData, RawPpltn } from './seoul';
import { StaleStore } from './stale-cache';

/**
 * 서울 API 응답의 마지막 성공본 보관소.
 *
 * 라우트 모듈이 아니라 여기에 두는 이유: 목록 라우트와 상세 라우트가 각자 인스턴스를
 * 만들면 같은 함수 인스턴스 안에서도 서로의 성공 이력을 못 본다. 저장소는 하나여야 한다.
 */

/**
 * 혼잡도(citydata_ppltn). 장소당 약 2KB 라 121곳을 다 들고 있어도 250KB 수준이다.
 * 그래서 상한을 전체 장소 수보다 넉넉히 잡아 사실상 evict 가 일어나지 않게 한다.
 */
export const ppltnStore = new StaleStore<RawPpltn>(200);

/**
 * 상세(citydata). 장소당 약 170KB 라 전부 들고 있으면 20MB 를 넘긴다.
 * 사용자가 실제로 눌러 본 최근 장소만 있으면 되므로 30곳으로 끊는다(약 5MB).
 */
export const cityDataStore = new StaleStore<RawCityData>(30);
