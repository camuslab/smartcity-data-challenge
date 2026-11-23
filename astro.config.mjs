// @ts-check
import { defineConfig } from 'astro/config';

// 배포 주소는 환경 변수로 받는다. GitHub Pages 워크플로가 저장소 이름에 맞춰 넣어 준다.
// 사용자 페이지(<user>.github.io)에서는 경로가 빈 문자열로 오므로 ?? 가 아니라 || 를 쓴다.
const site = process.env.SITE_URL || 'http://localhost:4321';
const base = process.env.SITE_BASE || '/';

export default defineConfig({
  site,
  base,
  trailingSlash: 'ignore',
  devToolbar: { enabled: false },
});
