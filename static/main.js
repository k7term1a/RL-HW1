const state = {
    n: 5,
    mode: "start",
    start: null,
    end: null,
    obstacles: new Set(),
    policy: {},
    values: {},
    topPaths: [],
    highlightedPathKeys: new Set(),
    pathStepByKey: {},
    activePathIndex: -1,
    actionScores: {},
    showActionScores: false,
};

const gridSizeInput = document.getElementById("gridSize");
const buildGridBtn = document.getElementById("buildGridBtn");
const generatePolicyBtn = document.getElementById("generatePolicyBtn");
const ensurePathBtn = document.getElementById("ensurePathBtn");
const actionScoreBtn = document.getElementById("actionScoreBtn");
const gridContainer = document.getElementById("gridContainer");
const obstacleCounter = document.getElementById("obstacleCounter");
const statusText = document.getElementById("statusText");
const topScores = document.getElementById("topScores");
const pathPreview = document.getElementById("pathPreview");
const modeSelector = document.getElementById("modeSelector");

const DIRECTIONS = {
    U: [-1, 0],
    D: [1, 0],
    L: [0, -1],
    R: [0, 1],
};

function cellKey(r, c) {
    return `${r},${c}`;
}

function parseKey(key) {
    return key.split(",").map(Number);
}

function maxObstacles() {
    return Math.max(0, state.n - 2);
}

function updateStatus(message, level = "warning") {
    statusText.textContent = message;
    statusText.classList.remove("status-success", "status-warning", "status-error");
    if (level === "success") {
        statusText.classList.add("status-success");
    } else if (level === "error") {
        statusText.classList.add("status-error");
    } else {
        statusText.classList.add("status-warning");
    }
}

function updateObstacleCounter() {
    obstacleCounter.textContent = `障礙物：${state.obstacles.size} / ${maxObstacles()}`;
}

function inBounds(r, c) {
    return r >= 0 && r < state.n && c >= 0 && c < state.n;
}

function isObstacleKey(key) {
    return state.obstacles.has(key);
}

function transitionByAction(r, c, action) {
    const [dr, dc] = DIRECTIONS[action];
    const nr = r + dr;
    const nc = c + dc;
    const nextKey = cellKey(nr, nc);
    if (!inBounds(nr, nc) || isObstacleKey(nextKey)) {
        return [r, c];
    }
    return [nr, nc];
}

function computeDirectionalActionScores() {
    const actionScores = {};
    if (!state.end) {
        return actionScores;
    }

    for (let r = 0; r < state.n; r += 1) {
        for (let c = 0; c < state.n; c += 1) {
            const key = cellKey(r, c);
            if (isObstacleKey(key)) {
                continue;
            }

            actionScores[key] = {};
            Object.keys(DIRECTIONS).forEach((action) => {
                const [nr, nc] = transitionByAction(r, c, action);
                const nextKey = cellKey(nr, nc);
                const isGoal = state.end[0] === nr && state.end[1] === nc;
                const reward = isGoal ? 100 : -1;
                const nextValue = Number(state.values[nextKey] ?? 0);
                const score = reward + 0.92 * nextValue;
                actionScores[key][action] = Number(score.toFixed(2));
            });
        }
    }
    return actionScores;
}

function setHighlightedPathState(pathIndex) {
    state.highlightedPathKeys.clear();
    state.pathStepByKey = {};
    state.activePathIndex = pathIndex;

    if (pathIndex < 0 || !state.topPaths[pathIndex]) {
        pathPreview.textContent = "移動到分數上可查看路徑。";
        return;
    }

    const activePath = state.topPaths[pathIndex];
    (activePath.path || []).forEach(([r, c], idx) => {
        const key = cellKey(r, c);
        state.highlightedPathKeys.add(key);
        // Display a 1-based step number for the currently previewed route.
        state.pathStepByKey[key] = idx + 1;
    });

    const route = (activePath.path || []).map(([r, c]) => `(${r},${c})`).join(" -> ");
    pathPreview.textContent = `${pathIndex + 1}. ${activePath.origin} | 分數: ${activePath.score}\n${route}`;
}

function renderTopScores() {
    if (!state.topPaths.length) {
        topScores.textContent = "目前沒有可顯示的路徑。";
        pathPreview.textContent = "移動到分數上可查看路徑。";
        return;
    }

    topScores.innerHTML = "";
    state.topPaths.slice(0, 3).forEach((item, idx) => {
        const scoreBtn = document.createElement("button");
        scoreBtn.type = "button";
        scoreBtn.className = "score-item";
        scoreBtn.textContent = `#${idx + 1} ${item.score}`;

        const activate = () => {
            setHighlightedPathState(idx);
            paintGrid();
        };
        const deactivate = () => {
            setHighlightedPathState(-1);
            paintGrid();
        };

        scoreBtn.addEventListener("mouseenter", activate);
        scoreBtn.addEventListener("mouseleave", deactivate);
        scoreBtn.addEventListener("focusin", activate);
        scoreBtn.addEventListener("focusout", deactivate);

        topScores.appendChild(scoreBtn);
    });
}

function createCellElement(r, c) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "grid-cell";
    el.dataset.r = String(r);
    el.dataset.c = String(c);
    el.setAttribute("aria-label", `格子 ${r},${c}`);
    el.addEventListener("click", () => onCellClick(r, c));
    return el;
}

function renderGrid() {
    gridContainer.innerHTML = "";
    gridContainer.style.gridTemplateColumns = `repeat(${state.n}, 1fr)`;

    for (let r = 0; r < state.n; r += 1) {
        for (let c = 0; c < state.n; c += 1) {
            const cell = createCellElement(r, c);
            gridContainer.appendChild(cell);
        }
    }
    paintGrid();
}

function resetSelections() {
    state.start = null;
    state.end = null;
    state.obstacles.clear();
    state.policy = {};
    state.values = {};
    state.topPaths = [];
    state.highlightedPathKeys.clear();
    state.pathStepByKey = {};
    state.activePathIndex = -1;
    state.actionScores = {};
    state.showActionScores = false;
    actionScoreBtn.textContent = "計算四向分數";
}

function applyModeToCell(r, c) {
    const key = cellKey(r, c);

    if (state.mode === "start") {
        state.obstacles.delete(key);
        state.start = [r, c];
        if (state.end && state.end[0] === r && state.end[1] === c) {
            state.end = null;
        }
        return;
    }

    if (state.mode === "end") {
        state.obstacles.delete(key);
        state.end = [r, c];
        if (state.start && state.start[0] === r && state.start[1] === c) {
            state.start = null;
        }
        return;
    }

    if (state.mode === "obstacle") {
        if (state.start && state.start[0] === r && state.start[1] === c) {
            state.start = null;
        }
        if (state.end && state.end[0] === r && state.end[1] === c) {
            state.end = null;
        }

        if (state.obstacles.has(key)) {
            state.obstacles.delete(key);
            return;
        }

        if (state.obstacles.size >= maxObstacles()) {
            updateStatus(`障礙物最多只能放 ${maxObstacles()} 個。`, "warning");
            return;
        }
        state.obstacles.add(key);
        return;
    }

    if (state.start && state.start[0] === r && state.start[1] === c) {
        state.start = null;
    }
    if (state.end && state.end[0] === r && state.end[1] === c) {
        state.end = null;
    }
    state.obstacles.delete(key);
}

function paintGrid() {
    const cells = gridContainer.querySelectorAll(".grid-cell");
    cells.forEach((cell) => {
        const r = Number(cell.dataset.r);
        const c = Number(cell.dataset.c);
        const key = cellKey(r, c);

        cell.classList.remove("start", "end", "obstacle", "path-hint", "path-hint-start", "path-hint-end");
        cell.textContent = "";

        if (state.obstacles.has(key)) {
            cell.classList.add("obstacle");
            cell.textContent = "X";
        } else if (state.start && state.start[0] === r && state.start[1] === c) {
            cell.classList.add("start");
            cell.textContent = "S";
        } else if (state.end && state.end[0] === r && state.end[1] === c) {
            cell.classList.add("end");
            cell.textContent = "G";
        }

        if (!state.obstacles.has(key)) {
            const policyInfo = state.policy[key];
            if (policyInfo && !(state.end && state.end[0] === r && state.end[1] === c)) {
                cell.textContent = policyInfo.arrow;
            }

            if (state.start && state.start[0] === r && state.start[1] === c) {
                cell.textContent = "S";
            }
            if (state.end && state.end[0] === r && state.end[1] === c) {
                cell.textContent = "G";
            }

            const value = state.values[key];
            if (value !== undefined) {
                const score = document.createElement("span");
                score.className = "score";
                score.textContent = `${value}`;
                cell.appendChild(score);
            }

            if (state.showActionScores && state.actionScores[key]) {
                const info = state.actionScores[key];
                const overlay = document.createElement("div");
                overlay.className = "action-score-overlay";
                overlay.innerHTML = `
          <span class="dir-score dir-u">U:${info.U}</span>
          <span class="dir-score dir-d">D:${info.D}</span>
          <span class="dir-score dir-l">L:${info.L}</span>
          <span class="dir-score dir-r">R:${info.R}</span>
        `;
                cell.appendChild(overlay);
            }

            const isStart = state.start && state.start[0] === r && state.start[1] === c;
            const isEnd = state.end && state.end[0] === r && state.end[1] === c;
            if (state.highlightedPathKeys.has(key)) {
                if (isStart) {
                    cell.classList.add("path-hint-start");
                } else if (isEnd) {
                    cell.classList.add("path-hint-end");
                } else {
                    cell.classList.add("path-hint");
                }

                const stepNum = state.pathStepByKey[key];
                if (stepNum !== undefined) {
                    const stepBadge = document.createElement("span");
                    stepBadge.className = "step-badge";
                    stepBadge.textContent = `${stepNum}`;
                    cell.appendChild(stepBadge);
                }
            }
        }
    });

    updateObstacleCounter();
}

function onCellClick(r, c) {
    applyModeToCell(r, c);
    state.policy = {};
    state.values = {};
    state.topPaths = [];
    state.highlightedPathKeys.clear();
    state.pathStepByKey = {};
    state.activePathIndex = -1;
    state.actionScores = {};
    state.showActionScores = false;
    actionScoreBtn.textContent = "計算四向分數";
    renderTopScores();
    paintGrid();
}

function toggleActionScores() {
    if (!state.start || !state.end || !Object.keys(state.values).length) {
        updateStatus("請先按「生成行動與評估」後再計算四向分數。", "warning");
        return;
    }

    if (!Object.keys(state.actionScores).length) {
        state.actionScores = computeDirectionalActionScores();
    }

    state.showActionScores = !state.showActionScores;
    actionScoreBtn.textContent = state.showActionScores ? "隱藏四向分數" : "顯示四向分數";
    updateStatus(
        state.showActionScores
            ? "已顯示每個網格的 U/D/L/R 行動分數。"
            : "已隱藏每個網格的 U/D/L/R 行動分數。",
        "success"
    );
    paintGrid();
}

function setMode(mode) {
    state.mode = mode;
    modeSelector.querySelectorAll(".mode-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.mode === mode);
    });
}

async function generatePolicyAndValues(ensurePath = false) {
    if (!state.start || !state.end) {
        updateStatus("請先設定起點與終點。", "warning");
        return;
    }

    const obstacleList = [...state.obstacles].map(parseKey);
    updateStatus(
        ensurePath
            ? "計算中：隨機生成策略，直到起點可通往終點..."
            : "計算中：隨機生成策略並進行評估...",
        "warning"
    );

    try {
        const res = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                n: state.n,
                start: state.start,
                end: state.end,
                obstacles: obstacleList,
                ensure_path: ensurePath,
            }),
        });

        const data = await res.json();
        if (!res.ok) {
            updateStatus(data.error || "產生失敗，請調整設定後再試。", "error");
            return;
        }

        state.policy = data.policy || {};
        state.values = data.values || {};
        state.topPaths = data.top_paths || [];
        state.highlightedPathKeys.clear();
        state.pathStepByKey = {};
        state.activePathIndex = -1;
        state.actionScores = {};
        state.showActionScores = false;
        actionScoreBtn.textContent = "計算四向分數";

        renderTopScores();
        paintGrid();

        if (state.topPaths.length === 0) {
            updateStatus("已完成評估，但目前找不到可到達終點的有效路徑。", "warning");
        } else {
            updateStatus(
                ensurePath
                    ? "完成：已保證存在由起點通往終點的策略路徑。"
                    : "完成：已生成策略，滑鼠移到分數可查看由起點沿箭頭前進的路徑。",
                "success"
            );
        }
    } catch (err) {
        updateStatus("發生錯誤，請確認 Flask 服務正常運作。", "error");
    }
}

function buildGridFromInput() {
    const n = Number(gridSizeInput.value);
    if (!Number.isInteger(n) || n < 3 || n > 10) {
        updateStatus("n 需為 3 到 10 的整數。", "warning");
        return;
    }

    state.n = n;
    resetSelections();
    renderTopScores();
    renderGrid();
    updateStatus("表格建立完成，請設定起點、終點與障礙物。", "success");
}

buildGridBtn.addEventListener("click", buildGridFromInput);
generatePolicyBtn.addEventListener("click", () => generatePolicyAndValues(false));
ensurePathBtn.addEventListener("click", () => generatePolicyAndValues(true));
actionScoreBtn.addEventListener("click", toggleActionScores);
modeSelector.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

renderTopScores();
renderGrid();
updateObstacleCounter();
updateStatus("請先建立表格並設定起點、終點與障礙物。", "warning");
