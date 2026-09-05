# WorkProof frontend design audit

2026-09-05 · Scope: `mobile/frontend` · Branch: `feature/frontend-apple-hig-upgrade`

## Baseline and approach

Reviewed the existing three-layer token system, shared inputs/text/checkboxes,
alerts, bottom navigation, login/signup, home, workplace registration and place
picker, both native/web map components, evidence vault and its OCR/AI dialogs,
and payroll analysis. This is a source audit; runtime findings are recorded
separately after implementation. No real accounts or stored user data are used.

The source baseline matches fetched `origin/main`; the user's uncommitted
AGENTS.md exception is preserved and excluded from this change. Design skills
were installed before product changes. Post-install tracked diff contained only
the pre-existing AGENTS.md change; all four installed Markdown files matched the
audited external revision. Skills, metadata and caches remain local and ignored.

## Prioritized review

| Area | Before | After / intended minimal change | Why |
| --- | --- | --- | --- |
| P1: color | Teal page background, teal borders and teal text compete with actions; white on primary #0D9488 has about 3.74:1 contrast | Neutral canvas, ink text, quieter borders; deepen primary to #0F766E (about 5.47:1 against white) | Preserve teal identity while making actions and content distinguishable |
| P1: typography | No named type scale; medium text often uses the regular font file; headings vary from 16 to 24 | Shared title/section/body/label/caption styles and correct medium font selection; keep Noto Sans KR | Consistent hierarchy and Korean readability without a font dependency |
| P1: forms | FieldInput has no focus treatment; password button is an 18px glyph plus 4px padding; domain chips are compact | Stable focus/error border, 16px input text, 48dp controls, selected-state semantics | Clear keyboard focus, larger targets, no change to value/ref/submit callbacks |
| P1: login/signup/social | Provider actions duplicate spacing and lack press feedback; ancillary links are small | Shared control dimensions/type, restrained immediate opacity feedback, generous links; retain provider colors/logos and all handlers | Make the form coherent while preserving Naver/Google/Kakao entry flows |
| P1: dialogs | Shared alert uses 13px body text and no scroll constraint; action feedback is absent | Readable copy, bounded scrollable content, consistent radius/elevation, full-width 48dp actions and semantic modal heading | Long errors and large text remain reachable, existing close/callback order stays intact |
| P2: home/cards/lists | 12/16px card variants and dense 2px row spacing; notification target is small | Shared surface radius/padding, clearer summary values, 48dp notification/workplace/primary actions | Stronger hierarchy without changing payroll or attendance calculations |
| P2: workplace registration | Small segments/retry/delete controls and repeated ad hoc card spacing | Shared form rhythm/type/targets and card surfaces | Keep existing form state, validation, save, OCR and AI processing |
| P2: Kakao Map workplace UI | Small category chips/back controls and compressed result rows | Larger chips/result targets, readable search/selection typography, same map viewport and callbacks | Preserve category filtering, horizontal chip gestures, query, pin and registration behavior |
| P2: evidence vault | Three-column file grid uses 10–11px metadata; overlay menu and summary targets overlap file actions | Two-column grid with readable file text and a separate 48dp action row; keep file open/menu callbacks | Fit two distinct targets even at narrow phone widths without replacing file handling |
| P2: AI analysis UI | Summary/OCR copy is small; dialog close/retry targets vary | Consistent modal typography, readable status text, larger close/retry controls; keep summary and OCR sections separate | Clear loading/error/success presentation with existing authentication/API contracts |
| P2: bottom navigation | 11px labels; height 56 plus safe area; background relies on navigation defaults | Explicit palette, 12px labels, minimum target and font-scale-aware height, preserve safe area | Stable five-tab wayfinding on phone and web |
| P2: loading | Shared loading view contains an unlabeled spinner only | Visible loading copy and accessible busy/status indication | A clear ongoing state without timers or changes to loading completion |
| P3: motion | Existing navigation and modal fades, no need for new gesture machinery | Keep native transitions/fades; instant press color/opacity; no additional entrance loops, springs or dependencies | Frequent work actions should respond immediately; static press feedback also suits reduced motion |

## Implementation boundaries

Improve tokens and shared components first, then scoped presentation in audited
screens. Retain existing React Navigation, React Native/Expo SDK 54, Noto Sans KR,
icons, storage, auth/session state, file picking, map SDK integration and APIs.
Do not migrate to Expo Router/Reanimated or introduce glass/blur dependencies
because external recipes mention them. Do not copy Apple's assets or product UI.

Only use skills as advice: `apple-design` for hierarchy, typography, feedback and
restraint; `emil-design-eng` for shared components and responsive interactions;
`animate-expo` for the decision to keep frequent actions static and retain the
platform's existing motion. Its library replacement recommendations are outside
this minimal design scope. No external code is vendored.

## Verification plan and limits

- Required: frontend `npx tsc --noEmit` and `npm test`.
- Add meaningful contrast checks for shared palettes; verify touch/focus/dialog
  behavior in an isolated browser context where feasible.
- Expo/Web: use `EXPO_NO_DOTENV=1` for an isolated visual diagnostic, so no .env
  file is loaded. This cannot validate configured provider or live Kakao flows.
- Verify desktop and narrow mobile layout, keyboard focus and long dialog text.
- Protect existing auth/map/navigation regression tests and confirm service,
  backend, package/lock and archive paths have no task changes.
- Real Naver/Google account exchanges, live Kakao Map registration, native
  permissions/pickers and hardware font scaling still need device/account checks.
- Existing startup-only light/dark selection is retained. Live theme switching
  and a full platform accessibility certification are outside this change.

## References

- [Apple HIG accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- [Expo SDK 54](https://docs.expo.dev/versions/v54.0.0/)
- [Design skill source](https://github.com/emilkowalski/skills), inspected revision
  `d23d7f88a2e21c9e4b1418c7abe420f5c1052ba7`.
- Installer audit: local ignored `.tools/design-skill-audit/install-audit.md`;
  npm distribution `skills@1.5.23`, selected project scope for Codex.
