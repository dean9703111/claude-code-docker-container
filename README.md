# Claude Code Docker 沙箱（Dev Container）

<p align="center">
  <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-CLI-D97757?logo=anthropic&logoColor=white" alt="Claude Code"></a>
  <img src="https://img.shields.io/badge/Dev_Container-supported-2496ED?logo=docker&logoColor=white" alt="Dev Container">
  <img src="https://img.shields.io/badge/base-node%3A24-339933?logo=nodedotjs&logoColor=white" alt="node:24">
  <img src="https://img.shields.io/badge/firewall-iptables%20%2F%20ipset-EE0000?logo=linux&logoColor=white" alt="Firewall">
  <img src="https://img.shields.io/badge/editor-VS%20Code%20%C2%B7%20Cursor-007ACC?logo=visualstudiocode&logoColor=white" alt="Editor">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs welcome">
</p>

在一個**網路受限的 Docker 容器**裡執行 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)，讓 AI Agent 可以在隔離環境中讀寫程式碼、執行指令，同時透過防火牆把對外連線限制在少數白名單網域，降低資料外洩與誤操作的風險。

本專案改自 Anthropic 官方的 `.devcontainer` [參考實作](https://github.com/anthropics/claude-code/tree/main/.devcontainer)。

---

## 目錄

- [目錄結構](#目錄結構)
- [需求](#需求)
- [快速開始](#快速開始)
- [這個容器裡有什麼](#這個容器裡有什麼)
- [注意事項](#注意事項)
- [Agent Skills](#agent-skills)
  - [目前安裝的 skills](#目前安裝的-skills)
  - [為什麼只留 frontend-design](#為什麼只留-frontend-design)
  - [安裝、移除與更新](#安裝移除與更新)
- [安裝 Plugins](#安裝-plugins)
- [調整防火牆（開放更多網域）](#調整防火牆開放更多網域)
- [加入 Python 環境](#加入-python-環境)
- [YouTube 留言彙整工具](#youtube-留言彙整工具)
- [常見問題](#常見問題)
- [授權](#授權)

---

## 目錄結構

```
.
├── .devcontainer/
│   ├── devcontainer.json   # Dev Container 設定（映像、掛載、環境變數、啟動指令）
│   ├── Dockerfile          # 容器映像：Node 24 + 開發工具 + Claude Code CLI
│   └── init-firewall.sh    # 啟動時套用的 iptables/ipset 防火牆規則
├── .agents/
│   └── skills/             # 用 `npx skills add` 安裝的 agent skills（正本，跨 agent 共用）
├── .claude/
│   ├── skills/             # Claude Code 讀取的 skills（多為指向 .agents/skills 的 symlink）
│   └── settings.local.json # 專案層級的本機設定（權限白名單等）
├── skills-lock.json        # skills 的來源與內容雜湊鎖定檔
├── package.json            # YouTube 留言彙整工具（見下方章節）
├── server.js               # 網頁服務與 SSE 進度串流
├── collector.js            # 兩階段流程：依上傳日期列影片 → 抓選定影片的留言
├── youtube.js              # 透過 youtubei.js 取得影片清單與留言
├── filter.js               # 相對時間換算、影片上傳日期判斷、留言關鍵字篩選
├── limit.js                # 後端保護：來源速率、單一任務與全站併發上限
├── markdown.js             # Markdown 輸出
├── public/index.html       # 前端頁面
├── filter.test.js          # 純邏輯測試
├── limit.test.js           # 後端保護的純邏輯測試
├── scenarios.test.js       # 實際連線 YouTube 的驗收測試
├── LICENSE
└── README.md
```

---

## 需求

- [Docker](https://www.docker.com/)（Desktop 或 Engine）
- IDE: [VS Code](https://code.visualstudio.com/)、[Cursor](https://cursor.so/)、[Antigravity](https://antigravity.dev/)
- 透過 Extensions 安裝 Dev Containers

---

## 快速開始

1. 用 IDE 開啟此資料夾。
2. 按 `F1` → `Dev Containers: Reopen in Container`。
3. 第一次會建置映像（image）並執行 `init-firewall.sh` 套用防火牆，請稍候。
4. 容器開好後，在整合終端機執行：
   ```bash
   claude
   ```
5. 依照指示完成登入即可開始使用。

> 你的程式碼透過 bind mount 掛載在容器內的 `/workspace`，在容器內的修改會直接反映到本機檔案。

---

## 這個容器裡有什麼

由 `Dockerfile` 建置：

- **基底**：`node:24`，從 AWS ECR Public 的 `public.ecr.aws/docker/library/node` 拉取。它是 Docker 官方映像的鏡像，內容與 Docker Hub 的 `node:24` 相同；改用它是因為 Docker Hub 的 registry 位於 AWS 美東，部分台灣網路連線不穩，會讓建置卡在拉取基底映像
- **Claude Code CLI**：`@anthropic-ai/claude-code`（版本由 `devcontainer.json` 的 `CLAUDE_CODE_VERSION` 控制，預設 `latest`）
- **開發工具**：`git`、`gh`（GitHub CLI）、`fzf`、`jq`、`vim`、`nano`、`zsh`（含 powerlevel10k）、[`git-delta`](https://github.com/dandavison/delta)
- **網路工具**：`iptables`、`ipset`、`dnsutils`、`aggregate`（防火牆需要）

由 `devcontainer.json` 設定：

- 預設使用者 `node`（非 root）
- `/workspace`：你的專案（bind mount）
- 兩個 named volume，**重建容器後仍會保留**：
  - `/home/node/.claude` → Claude Code 的設定、登入狀態、使用者層級 skills
  - `/commandhistory` → shell 歷史紀錄
- VS Code 預裝擴充套件：Claude Code、ESLint、Prettier、GitLens

---

## 注意事項

### 1. 防火牆會封鎖大部分對外連線

`init-firewall.sh` 會把 `OUTPUT` 預設政策設為 `DROP`，**只允許**以下白名單網域（其餘一律拒絕）：

- GitHub（`api.github.com` 動態取得的 IP 範圍）
- `registry.npmjs.org`（npm）
- `api.anthropic.com`（Claude）
- `sentry.io`、`statsig.anthropic.com`、`statsig.com`（遙測）
- VS Code Marketplace 相關網域

**這代表預設情況下無法存取 PyPI、apt 套件庫、其他 API 或任意網站。** 需要時請見下方「調整防火牆」。

### 2. 需要特殊權限

`devcontainer.json` 帶有 `--cap-add=NET_ADMIN --cap-add=NET_RAW`，讓容器能設定 iptables。這是套用防火牆所必需的。

### 3. `.claude/settings.local.json` 屬於本機設定

裡面的權限白名單（`permissions.allow`）通常含有特定機器的路徑，**不建議共用 / commit**（一般會放進 `.gitignore`）。團隊共用的設定請放 `.claude/settings.json`。

### 4. 沙箱不是萬靈丹

容器隔離與防火牆能降低風險，但仍建議在重要操作前檢視 Claude 的計畫，並善用權限提示。

---

## Agent Skills

[Agent Skills](https://skills.sh/) 是以 `SKILL.md` 為核心的可安裝知識包，Claude Code 會在任務符合其描述時自動載入。本專案用 [`skills` CLI](https://github.com/vercel-labs/skills) 安裝：

- 正本放在 `.agents/skills/`，`.claude/skills/` 以 symlink 指過去（其他 agent 也能共用同一份）
- `skills-lock.json` 記錄每個 skill 的來源 repo 與內容雜湊
- 這些檔案**都有進版控**，clone 下來就有，不用在容器裡重裝

### 目前安裝的 skills

| Skill | 來源 | 用途 | 在這個容器裡 |
| --- | --- | --- | --- |
| `frontend-design` | anthropics/skills | UI 視覺方向、字體、版面，避免「AI 模板感」 | 純文件，直接可用 |
| `git-smart-commit` | 本專案自訂 | 把雜亂變更拆成多個 conventional commit，與前端無關 | 純文件 |

> `git-smart-commit` 不是用 CLI 裝的，所以不在 `skills-lock.json` 裡；目前 `.agents/skills/` 與 `.claude/skills/` 各有一份相同的實體檔案，而不是 symlink。

### 為什麼只留 frontend-design

評估情境是**前端網頁專案**（例如 `feat/yt-comment-digest` 分支的 YouTube 留言彙整工具：單檔 HTML/CSS/JS 前端 + Node.js 伺服器），並把這個容器的實際條件一起考慮進去：**沒有 GUI、沒有 Python、對外連線受防火牆限制**。

結論是只留 `frontend-design` 負責「畫面該長什麼樣」：純文件、零相依，clone 下來就能用。原本一起裝的五個 skill 已移除：

| 已移除 | 原因 |
| --- | --- |
| `browser-use` | 與 `agent-browser` 功能重複；需要 Python 3.12、uv、有 GUI 的桌面 Chrome，容器內都沒有 |
| `skill-creator` | 用來撰寫、評測 skill 本身，與前端開發無關；還帶進 4000 多行 Python 與 HTML |
| `code-review-expert` | Claude Code 內建的 `/code-review`、`/security-review` 已涵蓋 |
| `find-skills` | 只是搜尋工具；`npx skills find` 走 `skills.sh/api/search`，防火牆未放行。想用就以 `-g` 裝到使用者層級 |
| `agent-browser` | 無頭瀏覽器自動化。skill 本身只是指引，實際要在 `Dockerfile` 另裝 Chromium 與系統函式庫才跑得起來，且尚未在本容器實測；目前專案用不到 |

之後可視需要再加：

- [`agent-browser`](https://github.com/vercel-labs/agent-browser)（vercel-labs/agent-browser）：無頭瀏覽器自動化，讓 Claude 自己開頁、點擊、截圖驗收 UI。當你希望 Claude 能自己驗收畫面時再加。
- [`web-design-guidelines`](https://skills.sh/vercel-labs/agent-skills/web-design-guidelines)（vercel-labs/agent-skills）：100+ 條可及性、效能、表單、深色模式等 UX 規則的稽核清單，純文件、無相依。當你開始在意鍵盤操作、對比度、表單錯誤提示這類細節時再加。
- 若專案改用 React / Next.js：同一個 repo 的 `react-best-practices` 與 `composition-patterns`。目前是純 HTML/JS，用不到。
- anthropics/skills 的 `webapp-testing`（Playwright 測試工具組）：需要 Python、`pip install playwright` 與從 Playwright CDN 下載 Chromium，三者在容器內都沒有或被防火牆擋住。若你依「加入 Python 環境」一節裝了 Python 並放行相關網域，它是 `agent-browser` 之外的另一個選擇。

### 安裝、移除與更新

以下指令在專案根目錄執行，容器內外皆可（`add` 只連 GitHub 與 npm registry，都在白名單內）：

```bash
npx skills add vercel-labs/agent-skills@web-design-guidelines -y   # 之後想加時
npx skills remove <skill-name> -y                                  # 移除

npx skills list      # 列出已安裝的 skills
npx skills check     # 檢查是否有更新
npx skills update    # 更新全部
```

> `npx skills find <關鍵字>` 會連 `skills.sh` 搜尋，容器內預設被擋；請在本機執行，或直接到 [skills.sh](https://skills.sh/) 瀏覽排行榜。

---

## 安裝 Plugins

Plugin 透過 marketplace 安裝，需在 `claude` 互動視窗中操作：

```text
/plugin marketplace add <owner/repo 或 marketplace URL>
/plugin install <plugin-name>
/plugin            # 開啟管理介面
```

> **防火牆提醒**：marketplace 與 plugin 多半從 GitHub 取得——GitHub 已在白名單內，通常可直接安裝。若 plugin 安裝過程需要存取**其他網域**（例如自架 registry），請先把該網域加入防火牆白名單（見下節）。

---

## 調整防火牆（開放更多網域）

編輯 `.devcontainer/init-firewall.sh`，在網域解析迴圈加入你需要的網域：

```bash
for domain in \
    "registry.npmjs.org" \
    "api.anthropic.com" \
    "pypi.org" \                  # ← 新增：PyPI
    "files.pythonhosted.org" \    # ← 新增：PyPI 套件下載
    "sentry.io" \
    ...
```

存檔後重新套用（擇一）：

```bash
sudo /usr/local/bin/init-firewall.sh   # 在現有容器中重跑
# 或在 VS Code 重建容器：F1 → Dev Containers: Rebuild Container
```

> 修改 `Dockerfile` 或 `devcontainer.json` 一定要 **Rebuild Container** 才會生效；只改 `init-firewall.sh` 則可直接重跑該腳本。

---

## 加入 Python 環境

基底映像是 `node:24`，**預設沒有 Python**。要使用 Python，編輯 `.devcontainer/Dockerfile`，在 `apt-get install` 區塊加入：

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
  less \
  git \
  # ...既有套件... \
  python3 \
  python3-pip \
  python3-venv \
  && apt-get clean && rm -rf /var/lib/apt/lists/*
```

或使用更快的 [`uv`](https://github.com/astral-sh/uv)（以非 root 的 `node` 使用者安裝）：

```dockerfile
USER node
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/home/node/.local/bin:$PATH"
```

**重點：別忘了防火牆**——安裝 PyPI 套件需要對外連線。請依上一節，把 `pypi.org` 與 `files.pythonhosted.org` 加入 `init-firewall.sh` 白名單，否則 `pip install` / `uv pip install` 會逾時失敗。

完成後 **Rebuild Container**，即可：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

> 若需要更完整的 Python 工具鏈，也可考慮在 `devcontainer.json` 改用官方 [Python Dev Container Feature](https://github.com/devcontainers/features/tree/main/src/python) 或直接換成 Python 基底映像。

---

## YouTube 留言彙整工具

放在本 repo 根目錄的小工具：貼上 **播放清單 / 單支影片 / 頻道** 網址，依上傳日期列出影片、勾選其中最多 20 支，把留言彙整成網頁，並可下載成 Markdown。
取留言不經 YouTube Data API、不需要 API key，改用 npm 套件 [`youtubei.js`](https://www.npmjs.com/package/youtubei.js)（YouTube 網頁端內部使用的 InnerTube 介面）。

### 啟動

```bash
npm install
npm start           # 預設 http://localhost:3000，可用 PORT 環境變數調整
```

> 在本容器裡跑要先讓防火牆放行 `youtube.com` / `googleusercontent.com`（見[調整防火牆](#調整防火牆開放更多網域)），否則抓不到資料。

### 使用方式

流程分兩段：**先列出影片 → 勾選要抓的（一次最多 20 支）→ 才開始抓留言**。頻道動輒上百支影片，這樣可以自己控制每一批的範圍。

1. **網址欄共用**：三種情境貼同一個欄位，程式自動判斷類型
   - 單支影片：`https://www.youtube.com/watch?v=VIDEO_ID`、`https://youtu.be/VIDEO_ID`、`/shorts/VIDEO_ID`
   - 播放清單：任何帶 `list=PL…` 的網址（例如 `watch?v=…&list=PL…`）→ 會列出清單內所有影片
   - 頻道：`https://www.youtube.com/@handle`、`/channel/UC…` → 會列出頻道的影片與 Shorts
   - 手邊沒網址的話，欄位下方有「單支影片／播放清單／頻道」三顆範例，點一下直接帶入
2. **篩選條件**（可留空）
   - 上傳起始日／結束日：篩的是**影片的上傳時間**，決定哪些影片會進到清單
   - 留言關鍵字：只保留內文含該關鍵字的留言（不分大小寫）
3. **按「列出影片」**：先只列清單、不抓留言。若有設日期，會逐支確認精確上傳時間（監看器上有進度）。執行中這顆會就地變成「停止列出」
4. **勾選要彙整的影片**：清單每頁 20 支，可翻頁；預設自動勾好前 20 支，選滿 20 支後其餘會淡出鎖住——但點下去仍會說明「已達上限，要換這支請先取消其他影片」，而不是沒反應。超過 20 支就分批做——這批抓完按「重新選擇影片」，會自動幫你勾下一批還沒抓過的
5. **按「開始彙整（N 支）」**：執行中這顆會就地變成「停止彙整」，其他按鈕（翻頁、重新選擇影片）一併鎖住，避免同時開出第二個任務。監看器顯示現正抓取的影片縮圖、標題、第幾支、已抓到幾則留言與整體進度
6. **看留言**：抓完的縮圖會從灰階恢復彩色並標上留言數，點任一張就在下方看該支影片的留言串（預設自動跟著剛抓完的影片，你手動點過之後就固定在你選的那支）
7. **匯出**：按「下載 Markdown」存成該支影片的 `.md`，或用「下載全部 Markdown」一次匯出（跨批次累積，不會因為換一批就不見）

### 影片上傳時間與留言時間

- **影片上傳時間（用來篩影片）是精確的**：清單頁只給相對時間（`3d ago`、`1mo ago`），頻道的 Shorts 甚至沒有時間欄位，所以工具先用相對時間的「可能區間」粗篩，再逐支去影片頁取回真正的上傳時間戳做最終判斷。代價是每支候選影片多一次請求，設了日期範圍的頻道要多等一下。
- **留言時間仍是估計值**：YouTube 只提供 `3 months ago` 這種相對時間，工具以抓取當下往回推算，越舊誤差越大。留言時間只用於顯示，不參與篩選。

### 保護機制

抓一次頻道會對 YouTube 發出大量請求，所以前後端都有節流，放到內網／公網給別人用時特別重要：

| 層級 | 規則 | 觸發時的訊息 |
|------|------|--------------|
| 單次工作量 | 一次最多彙整 20 支影片 | `一次最多 20 支影片（目前 N 支），請分批執行` |
| 來源頻率 | 每個來源每分鐘最多 20 次請求（被擋下的也計入） | `請求太頻繁，請等一分鐘再試` |
| 來源併發 | 同一個來源同時只能有一個任務 | `你已經有一個任務進行中，請先按停止或等它跑完` |
| 全站併發 | 同時最多 2 個任務 | `伺服器同時只處理 2 個任務，請稍後再試` |

上限值都在 `limit.js` 最上方。另外**前端一斷線（按停止、關分頁），後端的抓取迴圈就會中止**——沒有這一層的話，離開的任務會繼續在背景打 YouTube，並且一直占著上面的名額。

> `limit.js` 以 `req.ip`（連線來源）辨識來源。若部署在 Nginx 之類的反向代理後面，所有請求會長得像同一個來源，需要在 `server.js` 另外設定 `app.set('trust proxy', …)`。

### 篩選的階層規則

篩選是逐則留言判斷。若主留言不符合、但底下有符合的回覆，該串會保留回覆，主留言則顯示為「主留言不符合篩選條件」的佔位列，不會輸出內容、也不計入留言數。

### 測試

```bash
npm test              # 全部測試
node --test filter.test.js limit.test.js   # 只跑不連網的純邏輯測試
node --test scenarios.test.js   # 連線 YouTube 的驗收測試（約 2 分鐘）
```

`scenarios.test.js` 直接對真實網址驗收：播放清單影片數 ≥ 10、單支影片留言數 ≥ 400、頻道影片數 ≥ 40、日期區間內不得出現該期間外上傳的影片、一次超過 20 支會被擋下、斷線後背景工作會停下、關鍵字篩選後每則都含關鍵字。因為打的是真實網站，數字會隨影片更新而變動。

---

## 常見問題

**Q：`pip install` / `apt-get install` / `curl` 卡住或逾時？**
多半是防火牆擋住了該網域。確認目標網域已加入 `init-firewall.sh` 白名單並重跑腳本。

**Q：重建容器後要重新登入 Claude 嗎？**
通常不用——登入狀態存在 `/home/node/.claude` 這個 named volume，會被保留。

**Q：怎麼確認防火牆有生效？**
`init-firewall.sh` 結尾會自我驗證：能連到 `api.github.com`、且**無法**連到 `example.com` 才算通過。可看容器啟動日誌。

**Q：時區不對？**
在 `devcontainer.json` 透過 `TZ` 環境變數設定（預設 `America/Los_Angeles`），或在本機設定 `TZ` 環境變數讓它帶入。

**Q：`npx skills add` 在容器裡能用嗎？`npx skills find` 為什麼沒回應？**
`add` 只連 GitHub 與 npm registry，可以用。`find` 會連 `skills.sh` 的搜尋 API，防火牆預設沒放行，請在本機執行或到 [skills.sh](https://skills.sh/) 瀏覽。

---

## 授權

本專案以 [MIT License](./LICENSE) 釋出。`.devcontainer` 改自 Anthropic 官方 [claude-code](https://github.com/anthropics/claude-code/tree/main/.devcontainer)（同為 MIT）。
