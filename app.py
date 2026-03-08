from __future__ import annotations

import random
from typing import Dict, List, Optional, Set, Tuple

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

Cell = Tuple[int, int]
Action = str

ACTIONS: Dict[Action, Tuple[int, int, str]] = {
    "U": (-1, 0, "↑"),
    "D": (1, 0, "↓"),
    "L": (0, -1, "←"),
    "R": (0, 1, "→"),
}


def in_bounds(r: int, c: int, n: int) -> bool:
    return 0 <= r < n and 0 <= c < n


def valid_neighbors(cell: Cell, n: int, obstacles: Set[Cell]) -> List[Tuple[Action, Cell]]:
    r, c = cell
    results: List[Tuple[Action, Cell]] = []
    for action, (dr, dc, _) in ACTIONS.items():
        nr, nc = r + dr, c + dc
        nxt = (nr, nc)
        if in_bounds(nr, nc, n) and nxt not in obstacles:
            results.append((action, nxt))
    return results


def generate_policy(
    n: int,
    start: Cell,
    end: Cell,
    obstacles: Set[Cell],
) -> Dict[Cell, Action]:
    policy: Dict[Cell, Action] = {}
    for r in range(n):
        for c in range(n):
            cell = (r, c)
            if cell in obstacles or cell == end:
                continue
            neighbors = valid_neighbors(cell, n, obstacles)
            if not neighbors:
                continue
            action, _ = random.choice(neighbors)
            policy[cell] = action
    return policy


def transition(cell: Cell, action: Action, n: int, obstacles: Set[Cell]) -> Cell:
    dr, dc, _ = ACTIONS[action]
    nr, nc = cell[0] + dr, cell[1] + dc
    nxt = (nr, nc)
    if not in_bounds(nr, nc, n) or nxt in obstacles:
        return cell
    return nxt


def evaluate_policy(
    n: int,
    end: Cell,
    obstacles: Set[Cell],
    policy: Dict[Cell, Action],
    gamma: float = 0.92,
    max_iter: int = 800,
    threshold: float = 1e-5,
) -> Dict[Cell, float]:
    values: Dict[Cell, float] = {}
    for r in range(n):
        for c in range(n):
            cell = (r, c)
            if cell not in obstacles:
                values[cell] = 0.0

    for _ in range(max_iter):
        delta = 0.0
        new_values = values.copy()

        for cell in list(values.keys()):
            if cell == end:
                new_values[cell] = 0.0
                continue
            action = policy.get(cell)
            if not action:
                new_values[cell] = -5.0
                continue

            nxt = transition(cell, action, n, obstacles)
            reward = 100.0 if nxt == end else -1.0
            candidate = reward + gamma * values.get(nxt, 0.0)
            delta = max(delta, abs(candidate - values[cell]))
            new_values[cell] = candidate

        values = new_values
        if delta < threshold:
            break

    return values


def trace_policy_path(
    source: Cell,
    end: Cell,
    policy: Dict[Cell, Action],
    values: Dict[Cell, float],
    n: int,
    obstacles: Set[Cell],
) -> Optional[Tuple[List[Cell], float]]:
    path: List[Cell] = [source]
    visited: Set[Cell] = {source}
    current = source
    score_sum = values.get(source, 0.0)

    for _ in range(n * n):
        if current == end:
            return path, score_sum
        action = policy.get(current)
        if not action:
            return None

        nxt = transition(current, action, n, obstacles)
        if nxt == current:
            return None
        path.append(nxt)
        score_sum += values.get(nxt, 0.0)

        if nxt in visited and nxt != end:
            return None
        visited.add(nxt)
        current = nxt

    return None


def has_structural_path(start: Cell, end: Cell, n: int, obstacles: Set[Cell]) -> bool:
    stack: List[Cell] = [start]
    visited: Set[Cell] = {start}

    while stack:
        cur = stack.pop()
        if cur == end:
            return True
        for _, nxt in valid_neighbors(cur, n, obstacles):
            if nxt in visited:
                continue
            visited.add(nxt)
            stack.append(nxt)
    return False


def policy_path_from_start(
    n: int,
    start: Cell,
    end: Cell,
    obstacles: Set[Cell],
    policy: Dict[Cell, Action],
    values: Dict[Cell, float],
) -> List[Dict[str, object]]:
    traced = trace_policy_path(start, end, policy, values, n, obstacles)
    if not traced:
        return []

    path, score = traced
    return [
        {
            "origin": "起點策略路徑",
            "score": round(score, 2),
            "path": [[r, c] for r, c in path],
        }
    ]


@app.route("/")
def index() -> str:
    return render_template("index.html")


@app.route("/api/generate", methods=["POST"])
def api_generate():
    payload = request.get_json(silent=True) or {}
    ensure_path = bool(payload.get("ensure_path", False))

    try:
        n = int(payload.get("n", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "n 必須是整數"}), 400

    if n < 3 or n > 10:
        return jsonify({"error": "n 必須介於 3 到 10"}), 400

    start_data = payload.get("start")
    end_data = payload.get("end")
    obstacles_data = payload.get("obstacles", [])

    if not (isinstance(start_data, list) and len(start_data) == 2):
        return jsonify({"error": "請設定起點"}), 400
    if not (isinstance(end_data, list) and len(end_data) == 2):
        return jsonify({"error": "請設定終點"}), 400

    start = (int(start_data[0]), int(start_data[1]))
    end = (int(end_data[0]), int(end_data[1]))

    if not in_bounds(start[0], start[1], n) or not in_bounds(end[0], end[1], n):
        return jsonify({"error": "起點或終點超出範圍"}), 400
    if start == end:
        return jsonify({"error": "起點與終點不可相同"}), 400

    obstacles: Set[Cell] = set()
    for item in obstacles_data:
        if not (isinstance(item, list) and len(item) == 2):
            continue
        r, c = int(item[0]), int(item[1])
        if in_bounds(r, c, n):
            obstacles.add((r, c))

    if len(obstacles) > n - 2:
        return jsonify({"error": f"障礙物數量不可超過 {n - 2} 個"}), 400
    if start in obstacles or end in obstacles:
        return jsonify({"error": "障礙物不可與起點或終點重疊"}), 400

    if ensure_path and not has_structural_path(start, end, n, obstacles):
        return jsonify({"error": "障礙配置已封住起點到終點，請調整障礙物。"}), 400

    random.seed()
    max_retry = 2000 if ensure_path else 1
    policy: Dict[Cell, Action] = {}
    values: Dict[Cell, float] = {}
    found_path = False

    for _ in range(max_retry):
        policy = generate_policy(n, start, end, obstacles)
        values = evaluate_policy(n, end, obstacles, policy)
        traced = trace_policy_path(start, end, policy, values, n, obstacles)
        found_path = traced is not None
        if not ensure_path or found_path:
            break

    if ensure_path and not found_path:
        return jsonify({"error": "重試多次仍未形成可達策略，請再按一次或調整障礙。"}), 400

    top3 = policy_path_from_start(n, start, end, obstacles, policy, values)

    policy_payload = {
        f"{r},{c}": {
            "action": action,
            "arrow": ACTIONS[action][2],
            "next": list(transition((r, c), action, n, obstacles)),
        }
        for (r, c), action in policy.items()
    }

    values_payload = {f"{r},{c}": round(v, 2) for (r, c), v in values.items()}

    return jsonify(
        {
            "policy": policy_payload,
            "values": values_payload,
            "top_paths": top3,
        }
    )


if __name__ == "__main__":
    app.run(debug=True)
