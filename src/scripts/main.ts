import { initRoadNetworks } from './roads';
import { initClock } from './ui/clock';
import { initCopy } from './ui/copy';
import { initHeader } from './ui/header';
import { initReveal } from './ui/motion';

/**
 * js 클래스가 붙으면 스크롤 등장 요소가 숨겨진다.
 * 그 요소를 다시 보여 주는 initReveal을 가장 먼저 돌리고, 나머지는 하나가 실패해도 다음이 실행되게 한다.
 */
document.documentElement.classList.add('js');
for (const init of [initReveal, initHeader, initClock, initCopy, initRoadNetworks]) {
  try {
    init();
  } catch (error: unknown) {
    console.warn('[init]', init.name, error instanceof Error ? error.message : error);
  }
}
