(() => {
  const root = document.getElementById("tree-attention-explorer");
  if (!root) return;

  const orderType = root.dataset.order === "level" ? "level" : "dfs";
  const heightSelect = root.querySelector("#tree-height");
  const querySelect = root.querySelector("#query-node");
  const treeSvg = root.querySelector("#tree-svg");
  const maskSvg = root.querySelector("#mask-svg");
  const rowStripSvg = root.querySelector("#row-strip");
  const queryMetric = root.querySelector("#query-metric");
  const maxMetric = root.querySelector("#max-metric");
  const pathLabel = root.querySelector("#path-label");
  const panelOrder = root.querySelector("#panel-order");
  const svgNS = "http://www.w3.org/2000/svg";

  const makeSvg = (tag, attrs = {}) => {
    const element = document.createElementNS(svgNS, tag);
    Object.entries(attrs).forEach(([key, value]) => {
      element.setAttribute(key, String(value));
    });
    return element;
  };

  const buildTree = (height) => {
    const nodes = [];
    const total = (2 ** (height + 1)) - 1;
    for (let index = 0; index < total; index += 1) {
      const depth = Math.floor(Math.log2(index + 1));
      const offset = index - ((2 ** depth) - 1);
      const label = depth === 0
        ? "R"
        : `${String.fromCharCode(64 + depth)}${offset + 1}`;
      nodes.push({
        id: index,
        label,
        depth,
        offset,
        parent: index === 0 ? null : Math.floor((index - 1) / 2),
        children: [],
      });
    }

    nodes.forEach((node) => {
      if (node.parent !== null) nodes[node.parent].children.push(node.id);
    });

    const preorder = [];
    const visit = (id) => {
      preorder.push(id);
      nodes[id].children.forEach(visit);
    };
    visit(0);

    const order = orderType === "level" ? nodes.map((node) => node.id) : preorder;
    return { nodes, order };
  };

  const ancestorPath = (nodes, id) => {
    const path = [];
    let current = id;
    while (current !== null) {
      path.push(current);
      current = nodes[current].parent;
    }
    return path.reverse();
  };

  const intervalRuns = (columns) => {
    const runs = [];
    columns.forEach((column) => {
      const last = runs[runs.length - 1];
      if (!last || column !== last[last.length - 1] + 1) {
        runs.push([column]);
      } else {
        last.push(column);
      }
    });
    return runs;
  };

  const calculate = (tree, queryId) => {
    const position = new Map(tree.order.map((id, index) => [id, index]));
    const path = ancestorPath(tree.nodes, queryId);
    const visibleColumns = path
      .map((id) => position.get(id))
      .sort((a, b) => a - b);
    const runs = intervalRuns(visibleColumns);
    const allCounts = tree.nodes.map((node) => {
      const columns = ancestorPath(tree.nodes, node.id)
        .map((id) => position.get(id))
        .sort((a, b) => a - b);
      return intervalRuns(columns).length;
    });
    return {
      position,
      path,
      visibleColumns,
      runs,
      maxIntervals: Math.max(...allCounts),
    };
  };

  const renderTree = (tree, queryId, state) => {
    treeSvg.replaceChildren();
    const maxDepth = Math.max(...tree.nodes.map((node) => node.depth));
    const dense = maxDepth >= 4;
    const width = dense ? 720 : 520;
    const levelGap = dense ? 68 : 86;
    const height = 62 + (maxDepth * levelGap);
    treeSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    treeSvg.setAttribute("aria-labelledby", "tree-title tree-desc");

    const title = makeSvg("title", { id: "tree-title" });
    title.textContent = "树结构与选中 Query 的祖先路径";
    const desc = makeSvg("desc", { id: "tree-desc" });
    desc.textContent = `选中 ${tree.nodes[queryId].label}，路径为 ${state.path
      .map((id) => tree.nodes[id].label)
      .join(" 到 ")}`;
    treeSvg.append(title, desc);

    const coords = new Map();
    tree.nodes.forEach((node) => {
      const levelCount = 2 ** node.depth;
      coords.set(node.id, {
        x: ((node.offset + 0.5) * width) / levelCount,
        y: 28 + (node.depth * levelGap),
      });
    });
    const pathSet = new Set(state.path);

    tree.nodes.forEach((node) => {
      if (node.parent === null) return;
      const from = coords.get(node.parent);
      const to = coords.get(node.id);
      const onPath = pathSet.has(node.parent) && pathSet.has(node.id);
      treeSvg.appendChild(makeSvg("line", {
        x1: from.x,
        y1: from.y + (dense ? 5 : 14),
        x2: to.x,
        y2: to.y - (dense ? 5 : 14),
        class: onPath ? "edge edge-path" : "edge",
      }));
    });

    tree.nodes.forEach((node) => {
      const point = coords.get(node.id);
      const onPath = pathSet.has(node.id);
      const isQuery = node.id === queryId;
      const group = makeSvg("g");
      const nodeClass = isQuery
        ? "node node-query"
        : onPath
          ? "node node-path"
          : "node";

      if (dense) {
        group.appendChild(makeSvg("circle", {
          cx: point.x,
          cy: point.y,
          r: isQuery ? 7 : onPath ? 6 : 3.4,
          class: nodeClass,
        }));
        if (onPath) {
          const text = makeSvg("text", {
            x: point.x - 10,
            y: point.y,
            class: "node-label row-label",
          });
          text.textContent = node.label;
          group.appendChild(text);
        }
      } else {
        group.appendChild(makeSvg("rect", {
          x: point.x - 25,
          y: point.y - 15,
          width: 50,
          height: 30,
          rx: 7,
          class: nodeClass,
        }));
        const text = makeSvg("text", {
          x: point.x,
          y: point.y,
          class: isQuery ? "node-label node-label-query" : "node-label",
        });
        text.textContent = node.label;
        group.appendChild(text);
      }
      treeSvg.appendChild(group);
    });
  };

  const renderMask = (tree, queryId, state) => {
    maskSvg.replaceChildren();
    const count = tree.order.length;
    const cell = count <= 7 ? 38 : count <= 15 ? 26 : count <= 31 ? 15 : 8;
    const left = count <= 7 ? 54 : count <= 15 ? 48 : 38;
    const top = count <= 7 ? 58 : count <= 15 ? 52 : 34;
    const width = left + (cell * count) + 8;
    const height = top + (cell * count) + 8;
    maskSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    maskSvg.setAttribute("aria-labelledby", "mask-title mask-desc");

    const title = makeSvg("title", { id: "mask-title" });
    title.textContent = "Tree Attention 可见性矩阵";
    const desc = makeSvg("desc", { id: "mask-desc" });
    desc.textContent = `行是 Query，列是 KV。选中 ${tree.nodes[queryId].label}，其可见 KV 被分成 ${state.runs.length} 个区间。`;
    maskSvg.append(title, desc);

    const qTitle = makeSvg("text", { x: 4, y: top - 12, class: "axis-title" });
    qTitle.textContent = "Q ↓";
    const kvTitle = makeSvg("text", { x: left, y: 12, class: "axis-title" });
    kvTitle.textContent = "KV →";
    maskSvg.append(qTitle, kvTitle);

    if (count <= 15) {
      tree.order.forEach((id, index) => {
        const node = tree.nodes[id];
        const x = left + (index * cell) + (cell / 2);
        const y = top + (index * cell) + (cell / 2);
        const colLabel = makeSvg("text", {
          x,
          y: top - 10,
          class: "axis-label",
          transform: `rotate(-45 ${x} ${top - 10})`,
        });
        colLabel.textContent = node.label;
        const rowLabel = makeSvg("text", {
          x: left - 10,
          y,
          class: "axis-label row-label",
        });
        rowLabel.textContent = node.label;
        maskSvg.append(colLabel, rowLabel);
      });
    }

    const selectedRow = state.position.get(queryId);
    if (count > 15) {
      const selectedLabel = makeSvg("text", {
        x: left - 7,
        y: top + (selectedRow * cell) + (cell / 2),
        class: "axis-label row-label",
      });
      selectedLabel.textContent = tree.nodes[queryId].label;
      maskSvg.appendChild(selectedLabel);
    }

    const selectedPositions = new Set(state.visibleColumns);
    const firstVisible = state.visibleColumns[0];
    const lastVisible = state.visibleColumns[state.visibleColumns.length - 1];
    const intervalByColumn = new Map();
    state.runs.forEach((run, intervalIndex) => {
      run.forEach((column) => intervalByColumn.set(column, intervalIndex + 1));
    });

    tree.order.forEach((queryNodeId, row) => {
      const visible = new Set(
        ancestorPath(tree.nodes, queryNodeId)
          .map((ancestorId) => state.position.get(ancestorId)),
      );
      tree.order.forEach((_, column) => {
        const isVisible = visible.has(column);
        const isSelectedRow = row === selectedRow;
        const isHole = isSelectedRow
          && column >= firstVisible
          && column <= lastVisible
          && !selectedPositions.has(column);
        const className = isHole
          ? "cell-hole"
          : isSelectedRow && isVisible
            ? "cell-selected"
            : isVisible
              ? "cell-visible"
              : "cell-hidden";
        maskSvg.appendChild(makeSvg("rect", {
          x: left + (column * cell),
          y: top + (row * cell),
          width: cell,
          height: cell,
          class: className,
        }));

        if (count <= 15 && isSelectedRow && (isVisible || isHole)) {
          const text = makeSvg("text", {
            x: left + (column * cell) + (cell / 2),
            y: top + (row * cell) + (cell / 2),
            class: "cell-text",
          });
          text.textContent = isHole ? "×" : String(intervalByColumn.get(column));
          maskSvg.appendChild(text);
        }
      });
    });

    maskSvg.appendChild(makeSvg("rect", {
      x: left,
      y: top + (selectedRow * cell),
      width: cell * count,
      height: cell,
      class: "selected-row",
    }));
  };

  const renderRowStrip = (tree, queryId, state) => {
    rowStripSvg.replaceChildren();
    const count = tree.order.length;
    const left = 40;
    const right = 8;
    const width = 720;
    const plotWidth = width - left - right;
    const cell = plotWidth / count;
    const top = 30;
    const cellHeight = 22;
    const height = 62;
    rowStripSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    rowStripSvg.setAttribute("aria-labelledby", "strip-title strip-desc");

    const title = makeSvg("title", { id: "strip-title" });
    title.textContent = `${tree.nodes[queryId].label} 的 KV interval 分解`;
    const desc = makeSvg("desc", { id: "strip-desc" });
    desc.textContent = `选中 Query 的祖先 KV 在当前排列中形成 ${state.runs.length} 个连续区间。`;
    rowStripSvg.append(title, desc);

    const label = makeSvg("text", {
      x: left - 7,
      y: top + (cellHeight / 2),
      class: "axis-label row-label",
    });
    label.textContent = tree.nodes[queryId].label;
    rowStripSvg.appendChild(label);

    const visible = new Set(state.visibleColumns);
    const firstVisible = state.visibleColumns[0];
    const lastVisible = state.visibleColumns[state.visibleColumns.length - 1];
    for (let column = 0; column < count; column += 1) {
      const isVisible = visible.has(column);
      const isHole = column >= firstVisible && column <= lastVisible && !isVisible;
      rowStripSvg.appendChild(makeSvg("rect", {
        x: left + (column * cell),
        y: top,
        width: cell,
        height: cellHeight,
        class: isVisible
          ? "cell-selected"
          : isHole
            ? "cell-hole"
            : "cell-hidden",
      }));
    }

    state.runs.forEach((run, index) => {
      const centerColumn = (run[0] + run[run.length - 1] + 1) / 2;
      const text = makeSvg("text", {
        x: left + (centerColumn * cell),
        y: index % 2 === 0 ? 9 : 21,
        class: "cell-text",
      });
      text.textContent = String(index + 1);
      rowStripSvg.appendChild(text);
    });
  };

  const update = (resetQuery = false) => {
    const height = Number(heightSelect.value);
    const tree = buildTree(height);
    const previousLabel = querySelect.value;
    querySelect.replaceChildren();
    tree.order.forEach((id) => {
      const option = document.createElement("option");
      option.value = tree.nodes[id].label;
      option.textContent = tree.nodes[id].label;
      querySelect.appendChild(option);
    });

    const defaultLabel = `${String.fromCharCode(64 + height)}${2 ** height}`;
    const hasPrevious = tree.nodes.some((node) => node.label === previousLabel);
    querySelect.value = !resetQuery && hasPrevious ? previousLabel : defaultLabel;

    const queryId = tree.nodes.find((node) => node.label === querySelect.value).id;
    const state = calculate(tree, queryId);
    const pathNames = state.path.map((id) => tree.nodes[id].label);
    const intervalNames = state.runs.map((run) => (
      `[${run.map((column) => tree.nodes[tree.order[column]].label).join(", ")}]`
    ));

    queryMetric.textContent = `Query ${tree.nodes[queryId].label}: ${state.runs.length} intervals`;
    maxMetric.textContent = `全树最大: ${state.maxIntervals}`;
    pathLabel.textContent = `${pathNames.join(" → ")}  ${intervalNames.join(" + ")}`;
    panelOrder.textContent = orderType === "level" ? "BFS / level-order" : "DFS preorder";

    renderTree(tree, queryId, state);
    renderMask(tree, queryId, state);
    renderRowStrip(tree, queryId, state);
  };

  heightSelect.addEventListener("change", () => update(true));
  querySelect.addEventListener("change", () => update(false));
  update(true);
})();

