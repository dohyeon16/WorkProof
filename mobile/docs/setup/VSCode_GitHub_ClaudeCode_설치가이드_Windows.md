# VS Code에서 폴더 생성 → GitHub 연결 → Claude Code(CLI) 설치·실행 (Windows)

> Windows 기준 전체 흐름 가이드입니다. 위에서부터 순서대로 따라 하면 됩니다.
> `<...>` 로 표시된 부분은 본인 값으로 바꿔 넣으세요.

---

## 0. 사전 준비 — 먼저 설치할 것

시작하기 전에 아래 3가지가 준비되어 있어야 합니다.

| 항목 | 설명 | 다운로드 |
|------|------|----------|
| **VS Code** | 코드 편집기 | https://code.visualstudio.com |
| **Git for Windows** | 버전 관리 도구 (GitHub 연결에 필수) | https://git-scm.com/download/win |
| **GitHub 계정** | 원격 저장소 | https://github.com |

추가로 Claude Code를 **실행**하려면 아래 중 하나의 계정이 필요합니다.

- **Claude Pro / Max 구독** (claude.ai), 또는
- **Claude Team / Enterprise 플랜**, 또는
- **결제가 등록된 Anthropic Console 계정** (console.anthropic.com)
- ⚠️ **무료 Claude.ai 계정으로는 Claude Code를 사용할 수 없습니다.**

> **설치 확인 방법**: PowerShell을 열고 아래를 입력해 버전이 나오면 정상입니다.
> ```powershell
> code --version
> git --version
> ```

---

## 1. 새 폴더 만들고 VS Code로 열기

가장 쉬운 방법 하나만 선택하면 됩니다.

### 방법 A — VS Code 메뉴로 만들기 (추천)
1. VS Code 실행
2. 상단 메뉴 **File → Open Folder...** (`Ctrl+K Ctrl+O`)
3. 원하는 위치에서 **새 폴더** 버튼으로 폴더 생성 → 폴더명 입력 (예: `my-project`)
4. 그 폴더를 선택하고 **폴더 선택** 클릭
5. "이 폴더의 작성자를 신뢰합니까?" 창이 뜨면 **Yes, I trust the authors** 클릭

### 방법 B — 터미널로 만들기 (더 빠름)
PowerShell에서:
```powershell
cd <폴더를_만들_위치>        # 예: cd C:\Users\ryan\projects
mkdir my-project
cd my-project
code .                       # 현재 폴더를 VS Code로 열기
```

> `code .` 의 마지막 `.` 은 "현재 폴더"라는 뜻입니다.

---

## 2. Git 최초 설정 (최초 1회만)

커밋에 기록될 이름과 이메일을 등록합니다. **GitHub 가입 이메일과 동일하게** 넣는 것을 권장합니다.

VS Code 하단 터미널(`Ctrl + \``, 백틱)에서:
```bash
git config --global user.name "<이름>"
git config --global user.email "<GitHub_이메일>"
```

확인:
```bash
git config --global --list
```

---

## 3. GitHub 연결

두 가지 방법 중 하나를 고르세요. **방법 A(GUI)가 가장 쉽습니다.**

### 방법 A — VS Code에서 "Publish to GitHub" (가장 쉬움, 추천)

1. VS Code 왼쪽 사이드바에서 **Source Control** 아이콘 클릭 (`Ctrl+Shift+G`, 나뭇가지 모양)
2. **Initialize Repository** 버튼 클릭 → 로컬 Git 저장소가 생성됨
3. 파일이 있다면 변경 목록에 표시됨 → 상단 메시지 칸에 커밋 메시지 입력 (예: `first commit`) → **Commit** 클릭
   - "스테이징된 변경사항이 없다"는 안내가 나오면 **Yes** (모든 변경 자동 스테이징) 선택
4. **Publish Branch** 또는 **Publish to GitHub** 버튼 클릭
5. 처음이라면 GitHub 로그인 창(브라우저)이 뜸 → **Authorize** 로 로그인/승인
6. **공개(public)** 또는 **비공개(private)** 저장소 선택
7. 완료되면 GitHub에 저장소가 자동 생성되고 코드가 업로드됩니다 ✅

> 이 방법은 GitHub에서 저장소를 미리 만들 필요가 없습니다. VS Code가 알아서 만들어 줍니다.

### 방법 B — 명령어(CLI)로 연결

먼저 GitHub 웹에서 **빈 저장소**를 만듭니다.
1. https://github.com/new 접속
2. **Repository name** 입력 (예: `my-project`) → **Create repository**
   - ⚠️ README/.gitignore 등은 **체크하지 않고** 비워 두는 편이 충돌이 없습니다.
3. 생성 후 나오는 저장소 주소(`https://github.com/<사용자명>/my-project.git`)를 복사

VS Code 터미널에서:
```bash
git init                                  # 로컬 저장소 초기화
git add .                                 # 모든 파일 스테이징
git commit -m "first commit"              # 첫 커밋
git branch -M main                        # 기본 브랜치 이름을 main으로
git remote add origin https://github.com/<사용자명>/my-project.git
git push -u origin main                   # GitHub로 업로드
```

- 처음 `push` 할 때 로그인 창이 뜹니다. Git for Windows에 포함된 **Git Credential Manager**가 브라우저로 GitHub 로그인을 도와줍니다 → **Sign in with your browser** 로 로그인하면 이후 자동 저장됩니다.

> **연결 확인**: `git remote -v` 를 입력하면 등록된 GitHub 주소가 보입니다.

---

## 4. Claude Code(CLI) 설치 — Windows

Anthropic 공식 권장 방법은 **네이티브 설치 프로그램**입니다. Node.js가 필요 없고 자동 업데이트됩니다.

### 방법 A — PowerShell 네이티브 설치 (추천)
**PowerShell**에서 (관리자 권한 불필요):
```powershell
irm https://claude.ai/install.ps1 | iex
```

### 명령 프롬프트(cmd)를 쓴다면:
```cmd
curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd
```

### 대안 설치 방법
- **winget** (자동 업데이트 안 됨 — 가끔 수동 업데이트 필요):
  ```powershell
  winget install Anthropic.ClaudeCode
  # 업데이트: winget upgrade Anthropic.ClaudeCode
  ```
- **npm** (Node.js 22+ 필요, 구방식):
  ```bash
  npm install -g @anthropic-ai/claude-code
  ```

> 설치 후 `claude` 명령이 인식되지 않으면 **터미널(PowerShell/VS Code)을 완전히 닫았다가 다시 여세요.** (PATH 갱신 필요 — 아래 7번 참고)

---

## 5. 로그인 & 설치 확인

### 실행 및 로그인
터미널에서:
```bash
claude
```
- 첫 실행 시 브라우저가 열리며 로그인하라고 안내합니다 → 위 0번의 계정으로 로그인하면 됩니다.

### 설치 상태 확인
```bash
claude doctor
```
- 설치 방식, 버전, 설정, 인증 상태를 한 번에 점검해 줍니다. 문제가 없으면 준비 완료입니다. ✅

---

## 6. 프로젝트 폴더에서 Claude Code 실행

Claude Code는 **"현재 폴더"를 작업 대상으로** 삼습니다. 그래서 반드시 프로젝트 폴더 안에서 실행해야 합니다.

```bash
cd <프로젝트_폴더_경로>     # 예: cd C:\Users\ryan\projects\my-project
claude
```

### VS Code 안에서 바로 쓰기 (권장)
1. VS Code에서 프로젝트 폴더를 연 상태로
2. 통합 터미널 열기: **`Ctrl + \``** (백틱, 숫자 1 왼쪽 키)
3. 터미널에 `claude` 입력 → 열려 있는 폴더가 자동으로 작업 대상이 됩니다.

### (선택) VS Code 확장 설치
1. VS Code에서 `Ctrl+Shift+X` (Extensions)
2. **"Claude Code"** 검색 → **Install**
3. 확장을 설치하면 UI와 통합 터미널 양쪽에서 Claude Code가 연동됩니다.
   - Windows 단축키: `Alt+K` 로 파일의 특정 줄 범위를 @-멘션으로 삽입

---

## 7. 자주 겪는 문제 (트러블슈팅)

**`claude` 명령을 찾을 수 없다고 나올 때**
- 가장 흔한 원인: 설치 후 PATH가 아직 갱신되지 않음
- 해결: **터미널을 완전히 닫고 다시 열기.** 그래도 안 되면 PATH에 `~\.local\bin` 이 있는지 확인:
  ```powershell
  $env:Path -split ';' | Select-String '.local'
  ```
  없으면 **시스템 환경 변수 편집**에서 `C:\Users\<사용자명>\.local\bin` 을 Path에 추가

**`git` 명령을 못 찾을 때**
- Git for Windows가 설치 안 됐거나 터미널이 갱신 안 된 상태 → 재설치 후 터미널 다시 열기

**GitHub push 인증 실패**
- Git Credential Manager 로그인 창에서 **브라우저 로그인** 다시 시도
- 또는 GitHub CLI 사용: `winget install GitHub.cli` 설치 후 `gh auth login`

**npm으로 이미 설치했다가 네이티브로 바꿀 때**
- 기존 것을 먼저 제거: `npm uninstall -g @anthropic-ai/claude-code` → 이후 네이티브 설치

---

## 부록 — 전체 흐름 명령어 요약

```powershell
# 1) 폴더 생성 + VS Code 열기
mkdir my-project
cd my-project
code .

# 2) Git 최초 설정 (최초 1회)
git config --global user.name "<이름>"
git config --global user.email "<GitHub_이메일>"

# 3) GitHub 연결 (CLI 방식 — GitHub에서 빈 저장소 먼저 생성)
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/<사용자명>/my-project.git
git push -u origin main

# 4) Claude Code 설치 (PowerShell)
irm https://claude.ai/install.ps1 | iex
#   → 설치 후 터미널 다시 열기

# 5) 확인 & 실행
claude doctor
claude
```

---

### 참고 (공식 문서)
- Claude Code 설치: https://docs.claude.com/en/docs/claude-code/setup
- 인증/계정: https://docs.claude.com/en/docs/claude-code/iam
- VS Code 확장: https://code.claude.com/docs/en/vs-code
- 설치 문제 해결: https://support.claude.com/en/articles/14552646
