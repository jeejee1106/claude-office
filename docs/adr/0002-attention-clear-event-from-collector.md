# ADR 0002: 확인("?") 해제는 collector 가 보내는 `attention.clear` 이벤트로 한다

- 상태: 채택 (2026-10-24)
- 범위: packages/shared, packages/collector, apps/server, apps/web

## 맥락

사용자가 확인 창에 답하면 "?"가 바로 사라져야 한다. 그런데 Claude Code 2.1.306 에는 "허락했다"·"거절했다"를 알려 주는 훅이 없다(캡처 2026-10-23, 문서 2026-10-24: `PermissionDenied` 는 auto mode 분류기 거절에만, `PostToolUseFailure` 는 권한 거절에 오지 않는다). 허락 뒤에 처음 오는 신호는 그 도구의 `PostToolUse`/`PostToolUseFailure`, 요청 도구가 Agent 면 `SubagentStart` 다.

- `SubagentStart` 에는 부모(요청자)를 가리키는 필드가 없다. 그래서 `reduce` 는 `agent.spawn` 만 보고 "누구의 ? 를 지울지" 알 수 없다. 요청자·요청 도구를 아는 곳은 collector 의 권한 요청 기록(`perm-<session>.json`)뿐이다.
- `tool.end` 에서 `reduce` 가 지우는 방식(A안)은 Agent 호출에서 효과가 없고(서브가 끝나야 tool.end), 확인 창이 떠 있는 동안 병렬로 끝난 다른 도구의 tool.end 로 잘못 지워질 수 있다.

## 결정

1. 새 kind `attention.clear { reason? }` 를 추가한다(필드 추가 없이 새 kind 만 → `v` 는 1 그대로).
2. **판단은 collector 가 한다.** 확인 창을 띄운 요청(Notification 을 받은 요청)의 에이전트·도구 이름을 기억해 두었다가, 그 에이전트의 같은 도구 `PostToolUse`/`PostToolUseFailure`, 또는 Agent 도구면 같은 세션의 `SubagentStart` 에서 `attention.clear` 를 보낸다.
3. 한 훅에서 이벤트가 둘 생기면(`[attention.clear, tool.end]`, `[attention.clear, agent.spawn]`) **POST 한 번에 배열로** 보낸다(서버는 이미 배열을 받는다, MAX_BATCH 100). 훅 지연은 늘지 않는다.
4. `reduce` 는 `attention.clear` 로 에이전트를 만들거나 끝난 에이전트·세션을 되살리지 않는다.
5. `SnapshotMessage.recent` 는 항목별로 검증해 모르는 kind 만 빼고 snapshot 을 살린다. 앞으로 새 kind 를 더할 때 "새 서버 + 열려 있던 옛 탭" 조합에서 snapshot 이 통째로 버려지지 않게 하기 위해서다.

## 근거

- 요청자를 아는 쪽에서 판단해야 정확하다. `reduce` 에 추측 규칙을 넣으면 서버와 웹이 같은 추측을 공유할 뿐 맞지는 않는다.
- 새 kind 는 구버전 소비자가 버리므로(카탈로그 호환 규칙) 섞어 써도 깨지지 않는다: 옛 서버는 배열 중 그 항목만 거부하고 202, 옛 웹은 그 event 메시지만 무시한다.

## 결과·제약

- 일반 도구는 허락 순간이 아니라 **도구가 끝나는 순간** "?"가 사라진다(긴 Bash 면 그만큼 늦다). 허락 순간을 알 훅이 생기면 collector 만 바꾸면 된다.
- 사용자 거절은 신호가 없어 기존 규칙(다음 tool.start·prompt.submit·turn.end·agent.finish)으로만 지워진다. 실제 거절 캡처 후 보완한다.
- 이미 열려 있던 옛 웹 탭은 `SnapshotMessage` 수정 전 코드라 snapshot 에 `attention.clear` 가 있으면 그 snapshot 을 버린다(새로고침하면 해결). 이번 수정 이후 버전부터는 생기지 않는다.
