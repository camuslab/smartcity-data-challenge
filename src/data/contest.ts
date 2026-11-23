/**
 * 대회 정보의 단일 출처.
 * 내년에 날짜·상금·문구를 바꿀 때는 이 파일만 고치면 된다.
 * 날짜는 모두 한국 표준시(+09:00) ISO 문자열로 적는다.
 * 아래쪽 안내 문장(일정 설명, FAQ)은 위쪽 값에서 만들어지므로 숫자와 날짜를 따로 고칠 필요가 없다.
 */
import { koreanDate } from '../lib/format';
import sceneList from './hero-scenes.json';

/** 히어로 지도가 차례로 보여 주는 지역. 목록과 중심 좌표는 hero-scenes.json에 있고 도로망 생성 스크립트도 같은 파일을 읽는다. */
export interface HeroScene {
  /** 도로망 파일 이름에 쓰인다: public/data/roads-<id>.json */
  readonly id: string;
  readonly label: string;
  readonly area: string;
}

export const heroScenes: readonly HeroScene[] = sceneList.map(({ id, label, area }) => ({ id, label, area }));

export interface Prize {
  readonly tier: string;
  readonly teams: number;
  /** 팀당 상금(원) */
  readonly amount: number;
  readonly note: string;
}

export interface ScheduleItem {
  readonly id: string;
  readonly at: string;
  /** false면 시각 없이 날짜만 있는 일정이다. */
  readonly showTime: boolean;
  readonly title: string;
  readonly detail: string;
  readonly place?: string;
}

export interface Criterion {
  readonly label: string;
  readonly points: number;
}

export interface TopicExample {
  readonly field: string;
  readonly examples: string;
}

export interface FaqItem {
  readonly q: string;
  readonly a: string;
}

export const contest = {
  name: '스마트시티 데이터분석 경진대회',
  nameLines: ['스마트시티', '데이터분석', '경진대회'],
  year: 2026,
  host: '가천대학교 스마트시티학과',
  hostEn: 'Gachon University · Dept. of Smart City',
  email: 'jihoyeo@gachon.ac.kr',
  deadline: '2026-12-06T23:59:59+09:00',
  firstResult: '2026-12-07T00:00:00+09:00',
  venue: '가천대학교 AI공학관 100호',
  // 가천대학교 글로벌캠퍼스 중심 (OpenStreetMap 폴리곤 기준). 히어로 지도의 기준점과 같다.
  campus: { lat: 37.4527, lon: 127.1312, area: '경기도 성남시 수정구' },
  eligibility: '가천대학교 스마트시티학과 재학생 (복수전공·부전공 포함)',
  maxTeamSize: 5,
  maxSlides: 20,
  talkMinutes: 10,
  convergenceDay: {
    title: 'Convergence Day',
    theme: 'From Smart City to AI City',
    at: '2026-12-10T00:00:00+09:00',
  },
} as const;

/** 사이트 책임자와 제작자. 제작자는 페이지 맨 아래에 작게 표기한다. */
export const credits = {
  manager: { name: '여지호', affiliation: '가천대학교 부교수', email: contest.email },
  maker: { name: '김태우', affiliation: '가천대학교 CAMUS Lab 학부생', year: '3학년', email: 'twdaniel@gachon.ac.kr' },
} as const;

/** 대상·최우수상은 2차 발표평가로, 우수상은 1차 심사로 정한다. */
export const prizes: readonly Prize[] = [
  { tier: '대상', teams: 1, amount: 1_100_000, note: '2차 발표평가로 결정' },
  { tier: '최우수상', teams: 2, amount: 500_000, note: '2차 발표평가로 결정' },
  { tier: '우수상', teams: 3, amount: 300_000, note: '1차 심사로 확정' },
];

export const criteria: readonly Criterion[] = [
  { label: '도시 문제 설정의 타당성·적절성', points: 10 },
  { label: '데이터 수집·분석·처리의 완성도', points: 10 },
  { label: '문제 해결과 분석 결과의 완성도', points: 10 },
  { label: '발표 전달력', points: 10 },
];

/** 이해를 돕기 위한 예시. 공식 지정 주제가 아니다. */
export const topicExamples: readonly TopicExample[] = [
  { field: '교통·모빌리티', examples: '대중교통 이용 패턴, 보행 안전, 주차 수요' },
  { field: '환경·에너지', examples: '미세먼지, 도시 열섬, 건물 에너지 사용' },
  { field: '안전·방재', examples: '사고 다발 지점, 침수 위험, 야간 안전' },
  { field: '생활·복지', examples: '생활 인프라 접근성, 고령자 이동, 상권 변화' },
  { field: '도시계획·공간', examples: '토지 이용, 유동 인구, 공공시설 배치' },
];

const MERIT_TIER = '우수상';

export const totalPrize: number = prizes.reduce((sum, p) => sum + p.amount * p.teams, 0);
export const totalWinners: number = prizes.reduce((sum, p) => sum + p.teams, 0);
export const totalPoints: number = criteria.reduce((sum, c) => sum + c.points, 0);
/** 1차 심사만으로 확정되는 우수상 팀 수 */
export const meritTeams: number = prizes.filter((p) => p.tier === MERIT_TIER).reduce((sum, p) => sum + p.teams, 0);
/** 2차 발표평가에 진출하는 팀 수 */
export const finalistTeams: number = totalWinners - meritTeams;

const deadlineDay = koreanDate(contest.deadline);
const resultDay = koreanDate(contest.firstResult);
const finalDay = koreanDate(contest.convergenceDay.at);

export const schedule: readonly ScheduleItem[] = [
  {
    id: 'deadline',
    at: contest.deadline,
    showTime: true,
    title: '공모 제출 마감',
    detail: `${deadlineDay.time}까지 이메일로 제출합니다.`,
  },
  {
    id: 'first-result',
    at: contest.firstResult,
    showTime: false,
    title: '1차 입상팀 발표',
    detail: `2차 발표평가에 진출하는 ${finalistTeams}팀과 우수상 ${meritTeams}팀을 이메일로 알려 드립니다.`,
  },
  {
    id: 'final',
    at: contest.convergenceDay.at,
    showTime: false,
    title: '오프라인 2차 심사 · 시상',
    detail: `상위 ${finalistTeams}팀이 컨버전스 데이에서 발표하고, 대상과 최우수상을 가립니다.`,
    place: contest.venue,
  },
];

export const faq: readonly FaqItem[] = [
  {
    q: '주제에 제한이 있나요?',
    a: '없습니다. 스마트시티와 관련된 주제라면 무엇이든 가능합니다. 올해는 자유공모라서 분석할 데이터도 직접 고르고 수집합니다.',
  },
  {
    q: '혼자 참가해도 되나요? 상금이 달라지나요?',
    a: `개인으로 참가할 수 있고, 상금은 팀과 같습니다. 팀으로 참가한다면 팀원은 최대 ${contest.maxTeamSize}명입니다.`,
  },
  {
    q: '복수전공이나 부전공으로 스마트시티학과를 이수 중인데 참가할 수 있나요?',
    a: '참가할 수 있습니다. 가천대학교 스마트시티학과 재학생이면 되고, 복수전공과 부전공도 포함합니다.',
  },
  {
    q: `PPT ${contest.maxSlides}장을 꼭 채워야 하나요?`,
    a: `아닙니다. ${contest.maxSlides}장은 상한입니다. 양식은 자유이고, 분량보다 분석 내용이 잘 전달되는지가 중요합니다.`,
  },
  {
    q: 'PPT 말고 다른 결과물도 낼 수 있나요?',
    a: '웹페이지나 동영상을 PPT와 함께 제출할 수 있습니다. 링크나 파일을 같은 메일에 넣어 주세요.',
  },
  {
    q: '1차 결과는 어떻게 알 수 있나요?',
    a: `${resultDay.spoken}에 이메일로 알려 드립니다. 2차 발표평가에 진출하는 ${finalistTeams}팀과 우수상 ${meritTeams}팀이 이때 정해집니다.`,
  },
  {
    q: '2차 심사는 어떻게 진행되나요?',
    a: `상위 ${finalistTeams}팀이 ${finalDay.spoken} 컨버전스 데이에서 오프라인으로 발표합니다. 발표는 ${contest.talkMinutes}분 이내를 원칙으로 하며, 1차 심사와 2차 발표평가를 종합해 대상과 최우수상을 정합니다.`,
  },
];
