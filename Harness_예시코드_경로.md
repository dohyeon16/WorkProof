## 배치도

```
프로젝트루트/
├── CLAUDE.md                        ← Context (슬라이드 7)
├── .mcp.json                        ← Tool/MCP (프로젝트 공유, 커밋 대상)
└── .claude/
    ├── settings.json                ← Permission (슬라이드 11) + Hooks (슬라이드 15)
    ├── settings.local.json          ← 개인용 오버라이드 (gitignore 대상)
    ├── agents/
    │   └── explore.md               ← Subagent (슬라이드 24)
    ├── skills/
    │   └── bugfix/
    │       └── SKILL.md             ← Skill (슬라이드 19)
    └── hooks/                       ← (선택) hook 스크립트 보관 관례
```

## 예시코드별 상세

### 1. CLAUDE.md — 슬라이드 7 (Context)

| 항목 | 내용 |
|---|---|
| 경로 | 프로젝트 루트 `/CLAUDE.md` |
| 형식 | 순수 Markdown (.md). 프론트매터 없음 |
| 적용 | 세션 시작 시 자동 로드. 하위 폴더 CLAUDE.md는 해당 폴더 파일을 읽을 때 추가 로드 |
| 추가 위치 | `~/.claude/CLAUDE.md` (모든 프로젝트 공통, 개인용) — 두 파일은 병합(additive) |
| 심화 | `@경로/파일.md` import 문법 지원 (최대 5단계). 200줄 이하 유지 권장 |

슬라이드의 "프로젝트/규칙/금지/검증 4개 섹션" 구성은 그대로 유효하다. 단, 슬라이드 8의 지적대로 CLAUDE.md는 확률적 guidance이므로 "금지" 섹션의 항목은 반드시 settings.json `deny`와 hook으로 이중 강제해야 한다.

### 2. permissions — 슬라이드 11 (Permission)

| 항목 | 내용 |
|---|---|
| 경로 | `.claude/settings.json` (팀 공유, git 커밋) |
| 형식 | JSON. 주석(`//`) 불가 — 슬라이드의 `// .claude/settings.json` 주석은 실제 파일에서 제거해야 함 |
| 우선순위 | deny → ask → allow 순서로 평가. deny가 항상 이김 |
| 규칙 문법 | `Tool(패턴)`: `Bash(npm test:*)`, `Read(./secrets/**)`, `Edit(src/**)` |
| 개인 설정 | `.claude/settings.local.json` (gitignore). 배열은 스코프 간 병합됨 |

주의: 슬라이드 코드의 `"Read(**)"` 같은 전체 허용은 deny보다 후순위라 안전하지만, `Edit(**)`를 ask에 넣으면 모든 편집마다 승인 창이 뜬다. 실전에서는 `Edit(src/**)`를 allow로, 위험 경로만 deny로 좁히는 편이 낫다(심화 템플릿 참고).

### 3. hooks — 슬라이드 15 (Verification)

| 항목 | 내용 |
|---|---|
| 경로 | `.claude/settings.json`의 `"hooks"` 키 (permissions와 같은 파일에 공존 가능) |
| 형식 | JSON. `matcher`는 tool 이름 패턴(`"Edit|Write"`), 파이프 alternation 지원 |
| 이벤트 | PreToolUse(차단 가능), PostToolUse, PostToolUseFailure, UserPromptSubmit, Stop, PermissionRequest 등 |
| 동작 규약 | hook 커맨드는 stdin으로 JSON(session_id, tool_name, tool_input…)을 받음. exit 2 + stderr = 차단(PreToolUse), exit 0 + JSON stdout = 구조화된 결정 |

슬라이드의 `PostToolUse` + `npm test --silent` 예시는 문법상 정확하다. 다만 파일 하나 고칠 때마다 전체 테스트가 돌면 느리므로, 심화 버전에서는 변경 파일 관련 테스트만 도는 스크립트로 개선했다.

### 4. Skill — 슬라이드 19 (Tool)

| 항목 | 내용 |
|---|---|
| 경로 | `.claude/skills/bugfix/SKILL.md` — **폴더명 = 스킬명**, 파일명은 반드시 `SKILL.md` |
| 형식 | Markdown + YAML 프론트매터 (`---`로 감싼 name, description 필수) |
| 개인용 | `~/.claude/skills/<이름>/SKILL.md` |
| 심화 | 스킬 폴더에 `scripts/`, `examples/`, 템플릿 파일 동봉 가능. `disable-model-invocation: true`로 수동 호출 전용 지정 가능 |

슬라이드 설명("평소엔 description만 상주, 호출 시 본문 로드")은 정확하다. 참고: 과거의 `.claude/commands/*.md` 슬래시 커맨드는 여전히 동작하지만, 현재 공식 권장은 skills로 통합하는 것이다.

### 5. Subagent — 슬라이드 24 (Subagent & Worktree)

| 항목 | 내용 |
|---|---|
| 경로 | `.claude/agents/explore.md` — 파일명 자유, 프론트매터 `name`이 식별자 |
| 형식 | Markdown + YAML 프론트매터. `name`, `description` 필수 / `tools`, `model`, `permissionMode`, `maxTurns` 등 선택 |
| tools 제한 | `tools: Read, Grep, Glob` (쉼표 구분) → 수정 도구가 아예 없어 물리적으로 수정 불가 |
| 개인용 | `~/.claude/agents/*.md` |

### 6. git worktree — 슬라이드 24

| 항목 | 내용 |
|---|---|
| 형식 | 설정 파일이 아니라 셸 명령: `git worktree add ../proj-bugfix -b bugfix/auth` |
| 최신 지원 | `claude --worktree` 플래그로 워크트리 세션 직접 생성 가능. 데스크톱 앱은 세션마다 자동 워크트리 생성 |
| 보조 파일 | `.worktreeinclude` (프로젝트 루트) — gitignore된 파일 중 새 워크트리로 복사할 것(.env 등) 지정 |

### 7. 디버깅 템플릿 — 슬라이드 29 (Debugging)

| 항목 | 내용 |
|---|---|
| 원안 | "메모장에 저장해두고 붙여넣기" — 파일 위치 규정 없음 |
| 개선 | `.claude/skills/debug/SKILL.md`로 승격하면 `/debug`로 호출 가능. 6칸 템플릿을 스킬 본문에 내장 (심화 템플릿에 포함) |

## 형식 관련 공통 주의사항

JSON 파일(settings.json, .mcp.json)은 주석과 트레일링 콤마를 허용하지 않는다. 슬라이드 코드를 복붙할 때 `// ...` 줄을 지워야 한다. YAML 프론트매터는 반드시 파일 첫 줄의 `---`로 시작해야 하며, 인코딩은 UTF-8을 사용한다. `.claude/settings.json`과 `CLAUDE.md`, `.mcp.json`, `.claude/agents`, `.claude/skills`는 git에 커밋해 팀과 공유하고, `settings.local.json`만 gitignore한다.
