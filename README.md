# Claude & Codex Battery

macOS 메뉴바에서 Claude·Codex 사용량을 확인하는 개인용 SwiftBar 플러그인.

## 설치

1. 터미널에서 [Homebrew](https://brew.sh/)를 설치합니다. 이미 있다면 생략합니다.

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

설치 마지막에 표시되는 **Next steps** 명령을 실행한 뒤 계속합니다.

2. [Bun](https://bun.sh/docs/installation)과 [SwiftBar](https://formulae.brew.sh/cask/swiftbar)를 설치합니다.

```bash
brew install oven-sh/bun/bun
brew install --cask swiftbar
```

3. 사용할 CLI를 설치하고 로그인합니다. 이미 로그인했다면 생략합니다.

```bash
# Claude를 사용할 경우
brew install --cask claude-code
claude

# Codex를 사용할 경우
brew install --cask codex
codex login
codex
```

Codex는 로그인 후 한 번 사용해야 사용량 로그가 생깁니다.

4. [최신 ZIP 다운로드](https://github.com/Siturasu/claude-codex-battery/releases/latest/download/claude-codex-battery-macos.zip) 후 압축을 풀고 실행합니다.

```bash
cd ~/Downloads/claude-codex-battery
bash install.sh
```

설치 시 SwiftBar 플러그인 폴더를 `~/.swiftbar-plugins`로 지정하고 자동 시작을 등록합니다. 기존 SwiftBar 폴더를 사용하려면 `SWIFTBAR_PLUGIN_DIR="기존 폴더 경로" bash install.sh`로 실행하세요. 키체인 접근 창이 나타나면 허용해야 Claude 사용량을 읽을 수 있습니다.

선택: 비용 상세가 필요하면 `bun add -g ccusage`를 설치합니다.

## 사용 및 업데이트

메뉴바 아이콘을 눌러 표시 항목과 크기를 변경합니다. 2분마다 갱신하며 Codex 사용량은 최근 로컬 세션 기준입니다. 소진된 Codex 데이터가 오래되면 백그라운드 CLI 호출로 갱신을 시도합니다.

업데이트는 메뉴의 **업데이트**를 누르거나 최신 ZIP을 받아 `bash install.sh`를 다시 실행합니다.

## 커스텀 요소

메뉴바 라벨과 숫자 폰트는 원본과 다르게 바꿔 두었습니다.

- 아이콘: `assets/icon-claude.png`, `assets/icon-codex.png`. `install.sh`가 `~/.claude/swiftbar/`에 복사하고, 플러그인은 그 경로에 파일이 있으면 C, X 글자 대신 아이콘을 그립니다. 바꾸려면 같은 이름의 PNG(8비트, 비인터레이스)로 교체한 뒤 SwiftBar를 새로고침합니다. 검정이나 흰색 단색 실루엣이면 다크, 라이트 모드에 맞춰 자동으로 색을 입힙니다.
- 폰트: 메뉴바 숫자는 JetBrains Mono Bold를 안티에일리어싱해 만든 글리프 아틀라스로 그립니다. 스크립트의 `GLYPH_SETS`에 base64로 들어 있어 별도 폰트 설치가 필요 없습니다. 크게 15x18, 작게 11x13 픽셀.

[원본](https://github.com/dennykim123/claude-codex-battery) 기반. MIT 라이선스는 [LICENSE](LICENSE)를 참고하세요.
