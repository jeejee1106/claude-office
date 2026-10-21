import { defineConfig } from 'vitest/config'

// PixiJS 없이 도는 순수 로직(director·activityMap·socket 파서·store) 테스트만 둔다.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
