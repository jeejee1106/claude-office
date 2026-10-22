import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // 지연·CLI 테스트는 번들된 dist/ 를 실제 프로세스로 실행한다 → 먼저 빌드.
    globalSetup: ['test/global-setup.ts'],
  },
})
