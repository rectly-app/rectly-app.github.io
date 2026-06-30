/* ==================================================
 * DOM取得
 * ================================================== */

const selectFileButton = document.getElementById("selectFileButton");
const selectedFileName = document.getElementById("selectedFileName");

const canvas            = document.getElementById("canvas");
const ctx               = canvas.getContext("2d");
const outputCanvas      = document.getElementById("outputCanvas");

const fileInput         = document.getElementById("fileInput");

const ratioSelect       = document.getElementById("ratioSelect");
const customSizeArea    = document.getElementById("customSizeArea");
const customWidth       = document.getElementById("customWidth");
const customHeight      = document.getElementById("customHeight");
const orientationGroup  = document.getElementById("orientationGroup");

const zoomSelect        = document.getElementById("zoomSelect");

const gridToggle        = document.getElementById("gridToggle");
const gridSettings      = document.getElementById("gridSettings");
const gridAlphaInput    = document.getElementById("gridAlpha");
const gridWidthInput    = document.getElementById("gridWidth");

const inputInfo         = document.getElementById("inputInfo");
const outputInfo        = document.getElementById("outputInfo");

const logo              = document.getElementById("logo");


/* ==================================================
 * 定数
 * ================================================== */

const MAX_HISTORY = 20;

const POINT_RADIUS = 10;

const MAX_DISPLAY_WIDTH = 800;
const MAX_DISPLAY_HEIGHT = 800;


/* ==================================================
 * 状態変数
 * ================================================== */

let img = new Image();

let points = [];
let originalPoints = [];
let initialPoints = [];
let historyStack = [];

let lastResultCanvas = null;
let originalFileName = "output";

let mouseX = 0;
let mouseY = 0;

let selectedPointIndex = -1;

let draggingPointIndex = -1;
let draggingEdgeIndex = -1;
let lastMousePos = null;

let imageScale = 1;
let zoomScale = 1;

let transformTimer = null;

let showGrid = false;
let gridAlpha = 0.2;
let gridWidth = 1;

let toastTimer = null;


/* ==================================================
 * 初期化
 * ================================================== */

document.body.classList.add("theme-default");

initEvents();


/* ==================================================
 * 基本ユーティリティ
 * ================================================== */

// 2点間距離を取得
function distance(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

// 頂点を左上→右上→右下→左下に並べ替える
function sortPoints(pts) {
  const sortedY = [...pts].sort((a, b) => a.y - b.y);
  const top = sortedY.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sortedY.slice(2, 4).sort((a, b) => a.x - b.x);

  return [
    top[0],    // 左上
    top[1],    // 右上
    bottom[1], // 右下
    bottom[0]  // 左下
  ];
}

function getNaturalSize(pts) {
  const top = distance(pts[0], pts[1]);
  const bottom = distance(pts[2], pts[3]);
  const left = distance(pts[0], pts[3]);
  const right = distance(pts[1], pts[2]);

  return {
    width: Math.max(top, bottom),
    height: Math.max(left, right)
  };
}

// キャンバス外に出ない
function clampPoint(p) {
  p.x = Math.max(0, Math.min(canvas.width, p.x));
  p.y = Math.max(0, Math.min(canvas.height, p.y));
}

// 上下・左右の関係が崩れていないかチェック
function isValidQuad(pts) {
  const [tl, tr, br, bl] = pts;

  // 左右関係
  if (!(tl.x < tr.x && bl.x < br.x)) return false;

  // 上下関係
  if (!(tl.y < bl.y && tr.y < br.y)) return false;

  return true;
}

function isMinSizeOK(pts) {
  const MIN_EDGE_LENGTH = 20;

  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    if (Math.hypot(
      pts[i].x - pts[next].x,
      pts[i].y - pts[next].y
    ) < MIN_EDGE_LENGTH) {
      return false;
    }
  }
  return true;
}

function isEditingField() {
  const el = document.activeElement;

  return (
    el &&
    (
      el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT"
    )
  );
}


/* ==================================================
 * 履歴管理
 * ================================================== */

function saveHistory() {
  historyStack.push(
    originalPoints.map(p => ({
      x: p.x,
      y: p.y
    }))
  );

  if (historyStack.length > MAX_HISTORY) {
    historyStack.shift();
  }
}

function undo() {
  if (historyStack.length === 0) return;

  originalPoints = historyStack.pop();

  points = originalPoints.map(p => ({
    x: p.x * imageScale * zoomScale,
    y: p.y * imageScale * zoomScale
  }));

  selectedPointIndex = -1;

  draw();
  requestTransform();
}

function resetPoints() {
  saveHistory();

  if (!initialPoints.length) return;

  originalPoints = initialPoints.map(p => ({
    x: p.x,
    y: p.y
  }));

  points = originalPoints.map(p => ({
    x: p.x * imageScale * zoomScale,
    y: p.y * imageScale * zoomScale
  }));

  selectedPointIndex = -1;

  draw();
  requestTransform();
}


/* ==================================================
 * 比率計算
 * ================================================== */

// 出力比率を適用して最終サイズを算出
function applyAspectRatio(width, height) {
  const mode = ratioSelect.value;

  if (mode === "auto") {
    return {
      width: Math.round(width),
      height: Math.round(height)
    };
  }

  let targetRatio;

  const orientation =
    document.querySelector(
      'input[name="orientation"]:checked'
    ).value

  let finalOrientation = orientation;

  if (orientation === "auto") {
    finalOrientation =
      width >= height
        ? "landscape"
        : "portrait";
  }

  if (mode === "1:1") {
    targetRatio = 1;
  }
  else if (mode === "3:2") {
    targetRatio = 3 / 2;
  }
  else if (mode === "4:3") {
    targetRatio = 4 / 3;
  }
  else if (mode === "sqrt2") {
    targetRatio = Math.SQRT2;
  }
  else if (mode === "custom") {

    const w = parseFloat(
      customWidth.value
    );

    const h = parseFloat(
      customHeight.value
    );

    if (w <= 0 || h <= 0) {
      return {
        width: Math.round(width),
        height: Math.round(height)
      };
    }

    targetRatio = w / h;

    // 任意サイズは入力値から向きを決定
    finalOrientation =
      w >= h
        ? "landscape"
        : "portrait";
  }

  if (finalOrientation === "portrait") {
    if (targetRatio > 1) {
      targetRatio = 1 / targetRatio;
    }
  }
  else if (finalOrientation === "landscape") {
    if (targetRatio < 1) {
      targetRatio = 1 / targetRatio;
    }
  }

  const area = width * height;
  const newWidth = Math.sqrt(area * targetRatio);
  const newHeight = newWidth / targetRatio;

  return {
    width: Math.round(newWidth),
    height: Math.round(newHeight)
  };
}


/* ==================================================
 * 描画
 * ================================================== */

// 元画像キャンバスを再描画
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const POINT_RADIUS = 10;                             // 点の半径（固定）
  const outerLineWidth = 4;                           // 外枠の太さ（縁取り）
  const innerLineWidth = 2;                           // 点の内側線の太さ
  const crossLength = 5;                              // 十字の長さ
  const edgeLineWidth = 1;                            // 辺の線の太さ
  const centerEdgeLineWidth = 4;                      // 辺中央の太線（ドラッグ用）
  const hoverEdge = getEdgeHitIndex(mouseX, mouseY);  // ホバー中の辺を取得

  // 辺の描画
  for (let i = 0; i < points.length; i++) {
    const next = (i + 1) % points.length;
    ctx.beginPath();
    ctx.moveTo(points[i].x, points[i].y);
    ctx.lineTo(points[next].x, points[next].y);

    // 辺の中央部分を太線にする
    const midX = (points[i].x + points[next].x) / 2;
    const midY = (points[i].y + points[next].y) / 2;

    // 線は基本細め
    ctx.strokeStyle = (i === hoverEdge) ? "orange" : "red";
    ctx.lineWidth = edgeLineWidth;
    ctx.stroke();

    // 中央の太線（ドラッグ用）を描画
    ctx.beginPath();
    const offset = 20; // 太線の長さ
    const dx = points[next].x - points[i].x;
    const dy = points[next].y - points[i].y;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    ctx.moveTo(midX - ux * offset, midY - uy * offset);
    ctx.lineTo(midX + ux * offset, midY + uy * offset);
    ctx.lineWidth = (i === hoverEdge) ? 6 : centerEdgeLineWidth;
    ctx.stroke();
  }

  // 点の描画（外枠＋内枠＋十字）
  points.forEach((p, i) => {
    // 外枠（縁取り）
    ctx.beginPath();
    ctx.arc(p.x, p.y, POINT_RADIUS, 0, Math.PI * 2);
    ctx.lineWidth = outerLineWidth;
    ctx.strokeStyle = "white";
    ctx.stroke();

    // 内枠（赤色）
    ctx.beginPath();
    ctx.arc(p.x, p.y, POINT_RADIUS, 0, Math.PI * 2);
    ctx.lineWidth = innerLineWidth;
    ctx.strokeStyle = (i === selectedPointIndex) ? "orange" : "red";
    ctx.stroke();

    // 十字マーク
    ctx.beginPath();
    ctx.moveTo(p.x - crossLength, p.y);
    ctx.lineTo(p.x + crossLength, p.y);
    ctx.moveTo(p.x, p.y - crossLength);
    ctx.lineTo(p.x, p.y + crossLength);
    ctx.lineWidth = innerLineWidth;
    ctx.strokeStyle = (i === selectedPointIndex) ? "orange" : "red";
    ctx.stroke();
  });

  drawGridOnCanvas(canvas);
}

function drawGridOnCanvas(targetCanvas) {
  if (!showGrid) return;

  const targetCtx = targetCanvas.getContext("2d");
  const rows = 6;
  const cols = 6;

  targetCtx.save();

  targetCtx.globalAlpha = gridAlpha;
  targetCtx.shadowColor = "black";
  targetCtx.shadowBlur = 1;

  const isDark = document.body.classList.contains("theme-dark");

  targetCtx.strokeStyle =
    isDark ? "#ffffff" : "#666666";
  targetCtx.lineWidth = gridWidth;

  targetCtx.beginPath();

  for (let i = 1; i < rows; i++) {
    const y =
      targetCanvas.height * i / rows;

    targetCtx.moveTo(0, y);
    targetCtx.lineTo(targetCanvas.width, y);
  }

  for (let i = 1; i < cols; i++) {
    const x =
      targetCanvas.width * i / cols;

    targetCtx.moveTo(x, 0);
    targetCtx.lineTo(x, targetCanvas.height);
  }

  targetCtx.stroke();
  targetCtx.restore();
}

function updateZoom() {

  if (!img.src) return;

  canvas.width =
    img.width * imageScale * zoomScale;

  canvas.height =
    img.height * imageScale * zoomScale;

  points = originalPoints.map(p => ({
    x: p.x * imageScale * zoomScale,
    y: p.y * imageScale * zoomScale
  }));

  draw();
  requestTransform();
}


/* ==================================================
 * 四辺形操作
 * ================================================== */

function getEdgeHitIndex(x, y) {
  const threshold = 10;

  for (let i = 0; i < points.length; i++) {
    const next = (i + 1) % points.length;

    const x1 = points[i].x;
    const y1 = points[i].y;
    const x2 = points[next].x;
    const y2 = points[next].y;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);

    if (length === 0) continue;

    const t = ((x - x1) * dx + (y - y1) * dy) / (length * length);

    // 中央付近だけ判定（太線部分）
    if (t < 0.3 || t > 0.7) continue;

    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    const dist = Math.hypot(x - projX, y - projY);

    if (dist < threshold) {
      return i;
    }
  }
  
  return -1;
}


/* ==================================================
 * OpenCV変換
 * ================================================== */

// OpenCVで四点補正を実行
function transform() {
  let src = cv.imread(img);

  const ordered = sortPoints(originalPoints);

  // ① 自然サイズで変換
  const natural = getNaturalSize(ordered);
  let width = Math.round(natural.width);
  let height = Math.round(natural.height);

  let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    ordered[0].x, ordered[0].y,
    ordered[1].x, ordered[1].y,
    ordered[2].x, ordered[2].y,
    ordered[3].x, ordered[3].y
  ]);

  // 先に比率を決める
  const adjusted = applyAspectRatio(width, height);
  const mode = ratioSelect.value;
  const orientation =
    document.querySelector(
      'input[name="orientation"]:checked'
    ).value

  let finalOrientation = orientation;

  if (orientation === "auto") {
    finalOrientation =
      adjusted.width >= adjusted.height
        ? "landscape"
        : "portrait";
  }

  let ratioText = "自動";

  if (mode === "1:1") {
    ratioText = "1:1";
  }
  else if (mode === "3:2") {
    ratioText =
      finalOrientation === "portrait"
        ? "2:3"
        : "3:2";
  }
  else if (mode === "4:3") {
    ratioText =
      finalOrientation === "portrait"
        ? "3:4"
        : "4:3";
  }
  else if (mode === "sqrt2") {
    ratioText =
      finalOrientation === "portrait"
        ? "A/B判（縦）"
        : "A/B判（横）";
  }
  else if (mode === "custom") {
    ratioText = "任意";
  }

  outputInfo.textContent =
    `補正結果　${adjusted.width} × ${adjusted.height}px　(${ratioText})`;

  // その後でdstTriを作る
  let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,
    adjusted.width, 0,
    adjusted.width, adjusted.height,
    0, adjusted.height
  ]);

  let M = cv.getPerspectiveTransform(srcTri, dstTri);

  // ② 比率適用（先にやる）
  let warped = new cv.Mat();
  cv.warpPerspective(
    src,
    warped,
    M,
    new cv.Size(adjusted.width, adjusted.height)
  );

  // 表示処理（そのまま）
  // 幅・高さ両方を見る

  const scale = Math.min(
    MAX_DISPLAY_WIDTH / adjusted.width,
    MAX_DISPLAY_HEIGHT / adjusted.height,
    1
  );

  const displayWidth = Math.round(adjusted.width * scale);
  const displayHeight = Math.round(adjusted.height * scale);

  outputCanvas.width = displayWidth;
  outputCanvas.height = displayHeight;

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = adjusted.width;
  tempCanvas.height = adjusted.height;

  cv.imshow(tempCanvas, warped);

  // ダウンロード用に保持
  lastResultCanvas = tempCanvas;

  const outCtx = outputCanvas.getContext("2d");

  outCtx.drawImage(
    tempCanvas, 
    0, 
    0, 
    displayWidth, 
    displayHeight
  );

  drawGridOnCanvas(outputCanvas);

  src.delete();
  warped.delete();
  M.delete();
  srcTri.delete();
  dstTri.delete();
}

// 変換処理の連続実行を抑制
function requestTransform() {

  clearTimeout(transformTimer);

  transformTimer = setTimeout(() => {

    if (!img.src) return;

    transform();

  }, 30);

}

function downloadImage() {
  if (!lastResultCanvas) {
    alert("先に画像を読み込んでください");
    return;
  }

  const format =
    document.querySelector(
      'input[name="format"]:checked'
    ).value;

  // MIMEに応じて拡張子決定
  const ext = format === "image/png" ? "png" : "jpg";

  let dataUrl;

  if (format === "image/jpeg") {
    dataUrl = lastResultCanvas.toDataURL(
      format,
      1.0
    );
  } else {
    dataUrl = lastResultCanvas.toDataURL(format);
  }

  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = `${originalFileName}_corrected.${ext}`;
  link.click();

  showToast();
}


/* ==================================================
 * 自動検出
 * ================================================== */

// エッジ検出方式で四角形候補を探す
function detectByEdges(src) {
  let gray = new cv.Mat();
  let edges = new cv.Mat();

  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
  cv.Canny(gray, edges, 50, 150);

  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();
  cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  let best = getBestQuad(contours);

  gray.delete(); edges.delete(); contours.delete(); hierarchy.delete();

  return best;
}

// 面積検出方式で四角形候補を探す
function detectByMass(src) {
  let gray = new cv.Mat();
  let thresh = new cv.Mat();
  let morph = new cv.Mat();

  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, gray, new cv.Size(15, 15), 0);

  cv.adaptiveThreshold(
    gray, thresh, 255,
    cv.ADAPTIVE_THRESH_MEAN_C,
    cv.THRESH_BINARY_INV,
    51, 5
  );

  let kernel = cv.Mat.ones(15, 15, cv.CV_8U);
  cv.morphologyEx(thresh, morph, cv.MORPH_CLOSE, kernel);

  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();
  cv.findContours(morph, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  let best = getBestQuad(contours);

  gray.delete(); thresh.delete(); morph.delete();
  contours.delete(); hierarchy.delete(); kernel.delete();

  return best;
}

// 輪郭群から最適な四角形を選択
function getBestQuad(contours) {
  let bestQuad = null;
  let bestScore = 0;

  for (let i = 0; i < contours.size(); i++) {
    let cnt = contours.get(i);
    let area = cv.contourArea(cnt);
    if (area < 5000) continue;

    let peri = cv.arcLength(cnt, true);
    let approx = new cv.Mat();
    cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

    if (approx.rows === 4 && cv.isContourConvex(approx)) {
      let rect = cv.boundingRect(approx);
      let rectangularity = area / (rect.width * rect.height);
      let aspect = rect.width / rect.height;
      // スコア（面積×矩形らしさ）
      let score = area * rectangularity;

      if (aspect < 0.3 || aspect > 3.0) continue;

      if (score > bestScore) {
        if (bestQuad) {
          bestQuad.delete();
        }

        bestQuad = approx.clone();
        bestScore = score;
      }

      approx.delete();
    }
  }

  return bestQuad;
}

// 自動検出を実行
function autoDetectPoints() {
  if (!window.cvReady) {
    alert("OpenCVを読み込み中です");
    return;
  }

  if (!img.src) {
    alert("先に画像を読み込んでください");
    return;
  }

  let src = cv.imread(img);
  let quad1 = detectByEdges(src);
  let quad2 = detectByMass(src);

  function score(quad) {
    if (!quad) return 0;
    let rect = cv.boundingRect(quad);
    let area = cv.contourArea(quad);
    return area / (rect.width * rect.height);
  }

  let bestQuad;
  let otherQuad;

  if (score(quad1) > score(quad2)) {
    bestQuad = quad1;
    otherQuad = quad2;
  } else {
    bestQuad = quad2;
    otherQuad = quad1;
  }

  if (!bestQuad) {
    src.delete();
    alert("四角形を検出できませんでした");
    return;
  }

  let detected = [];

  for (let i = 0; i < 4; i++) {
    let x = bestQuad.intPtr(i, 0)[0];
    let y = bestQuad.intPtr(i, 0)[1];
    detected.push({ x, y });
  }

  detected = sortPoints(detected);

  saveHistory();

  originalPoints = detected;

  points = detected.map(p => ({
    x: p.x * imageScale * zoomScale,
    y: p.y * imageScale * zoomScale
  }));

  draw();
  requestTransform();

  src.delete();

  if (bestQuad) {
    bestQuad.delete();
  }

  if (otherQuad) {
    otherQuad.delete();
  }
}


/* ==================================================
 * Canvasイベント
 * ================================================== */

canvas.addEventListener("mousedown", (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // ① 頂点優先
  for (let i = 0; i < points.length; i++) {
    if (Math.hypot(points[i].x - x, points[i].y - y) < POINT_RADIUS) {
      draggingPointIndex = i;
      saveHistory();
      selectedPointIndex = i;
      return;
    }
  }

  // ② 辺判定
  const edgeIndex = getEdgeHitIndex(x, y);
  if (edgeIndex !== -1) {
    saveHistory();
    draggingEdgeIndex = edgeIndex;
    lastMousePos = { x, y };
    selectedPointIndex = -1;
    return;
  }

  // 何も当たらなかったら選択解除
  selectedPointIndex = -1;
  draw();
});

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // マウス位置を保存
  mouseX = x;
  mouseY = y;

  let cursor = "default";

  // ① 辺判定（先にやる）
  const edgeIndex = getEdgeHitIndex(x, y);
  if (edgeIndex !== -1) {
    const next = (edgeIndex + 1) % points.length;
    const dxEdge = points[next].x - points[edgeIndex].x;
    const dyEdge = points[next].y - points[edgeIndex].y;

    const isHorizontal = Math.abs(dxEdge) > Math.abs(dyEdge);
    cursor = isHorizontal ? "ns-resize" : "ew-resize";
  }

  // ② 頂点は最優先で上書き
  for (let i = 0; i < points.length; i++) {
    if (Math.hypot(points[i].x - x, points[i].y - y) < POINT_RADIUS + 3) {
      cursor = "pointer";
    }
  }

  canvas.style.cursor = cursor;

  // 頂点ドラッグ
  if (draggingPointIndex !== -1) {
    // 仮更新
    const newPoints = points.map(p => ({ ...p }));
    newPoints[draggingPointIndex] = { x, y };

    // 制約適用
    clampPoint(newPoints[draggingPointIndex]);

    // 順序崩壊＆サイズチェック
    if (isValidQuad(newPoints) && isMinSizeOK(newPoints)) {
      points = newPoints;

      originalPoints[draggingPointIndex] = {
        x: points[draggingPointIndex].x / (imageScale * zoomScale),
        y: points[draggingPointIndex].y / (imageScale * zoomScale)
      };

      draw();
      requestTransform();
    }
    return;
  }

  // 辺ドラッグ（軸制限版）
  if (draggingEdgeIndex !== -1 && lastMousePos) {
    const dx = x - lastMousePos.x;
    const dy = y - lastMousePos.y;

    const i = draggingEdgeIndex;
    const next = (i + 1) % points.length;

    const p1 = points[i];
    const p2 = points[next];

    const edgeDx = p2.x - p1.x;
    const edgeDy = p2.y - p1.y;

    // 辺の向き判定
    const isHorizontal = Math.abs(edgeDx) > Math.abs(edgeDy);

    let moveX = 0;
    let moveY = 0;

    if (isHorizontal) {
      // 横辺 → Yのみ動かす
      moveY = dy;
    } else {
      // 縦辺 → Xのみ動かす
      moveX = dx;
    }

    // 仮更新
    const newPoints = points.map(p => ({ ...p }));

    newPoints[i].x += moveX;
    newPoints[i].y += moveY;
    newPoints[next].x += moveX;
    newPoints[next].y += moveY;

    // キャンバス制限
    clampPoint(newPoints[i]);
    clampPoint(newPoints[next]);

    // 制約チェック
    if (isValidQuad(newPoints) && isMinSizeOK(newPoints)) {
      points = newPoints;

      originalPoints[i] = {
        x: points[i].x / (imageScale * zoomScale),
        y: points[i].y / (imageScale * zoomScale)
      };
      originalPoints[next] = {
        x: points[next].x / (imageScale * zoomScale),
        y: points[next].y / (imageScale * zoomScale)
      };

      lastMousePos = { x, y };
      draw();
      requestTransform();
    }
  }
});

canvas.addEventListener("mouseup", () => {
  mouseX = -1;
  mouseY = -1; 
  draggingPointIndex = -1;
  draggingEdgeIndex = -1;
  draw();
});

canvas.addEventListener("mouseleave", () => {
  mouseX = -1;
  mouseY = -1; 
  draggingPointIndex = -1;
  draggingEdgeIndex = -1;
  draw();
});


/* ==================================================
 * キーボードイベント
 * ================================================== */

window.addEventListener("keydown", (e) => {
  if (isEditingField()) {
    return;
  }

  if (
    (e.ctrlKey || e.metaKey)
    && e.key.toLowerCase() === "z"
  ) {
    e.preventDefault();
    undo();
    return;
  }

  if (selectedPointIndex === -1) return;

  let moveX = 0;
  let moveY = 0;

  const step = e.shiftKey ? 10 : 1; // Shiftで加速

  if (e.key === "ArrowUp") moveY = -step;
  if (e.key === "ArrowDown") moveY = step;
  if (e.key === "ArrowLeft") moveX = -step;
  if (e.key === "ArrowRight") moveX = step;

  if (moveX === 0 && moveY === 0) return;
  e.preventDefault();

  const newPoints = points.map(p => ({ ...p }));

  newPoints[selectedPointIndex].x += moveX;
  newPoints[selectedPointIndex].y += moveY;

  // 制約適用
  clampPoint(newPoints[selectedPointIndex]);

  if (isValidQuad(newPoints) && isMinSizeOK(newPoints)) {
    points = newPoints;

    originalPoints[selectedPointIndex] = {
      x: points[selectedPointIndex].x / (imageScale * zoomScale),
      y: points[selectedPointIndex].y / (imageScale * zoomScale)
    };

    draw();
    requestTransform();
  }
});


/* ==================================================
 * トースト通知
 * ================================================== */

function showToast(message = "保存しました") {

  const toast = document.getElementById("toast");
  const text = toast.querySelector(".toast-message");

  text.textContent = message;

  clearTimeout(toastTimer);

  toast.classList.add("show");

  toastTimer = setTimeout(() => {

    toast.classList.remove("show");

  }, 1500);
}


/* ==================================================
 * UIイベント登録
 * ================================================== */

function initEvents() {

  selectFileButton.addEventListener(
    "click",
    () => {
      fileInput.click();
    }
  );

  // 画像読み込み

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    selectedFileName.textContent =
      file.name;

    historyStack = [];
    selectedPointIndex = -1;

    // 拡張子を除いた名前を保存
    originalFileName = file.name.replace(/\.[^/.]+$/, "");

    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {

        imageScale = Math.min(
          1,
          MAX_DISPLAY_WIDTH / img.width,
          MAX_DISPLAY_HEIGHT / img.height
        );

        canvas.width =
          img.width * imageScale * zoomScale;

        canvas.height =
          img.height * imageScale * zoomScale;

        inputInfo.textContent =
          `元画像　${img.width} × ${img.height}px`;

        originalPoints = [
          { x: 0, y: 0 },
          { x: img.width, y: 0 },
          { x: img.width, y: img.height },
          { x: 0, y: img.height }
        ];

        initialPoints = originalPoints.map(p => ({
          x: p.x,
          y: p.y
        }));

        points = originalPoints.map(p => ({
          x: p.x * imageScale * zoomScale,
          y: p.y * imageScale * zoomScale
        }));

        draw();
        requestTransform();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });


  // グリッド設定

  gridToggle.addEventListener("change", (e) => {
    showGrid = e.target.checked;

    gridSettings.classList.toggle(
      "hidden",
      !showGrid
    );

    draw();
    requestTransform();
  });

  gridAlphaInput.addEventListener("input", (e) => {
    gridAlpha = parseFloat(e.target.value);

    draw();
    requestTransform();
  });

  gridWidthInput.addEventListener("input", (e) => {
    gridWidth = parseInt(e.target.value);

    draw();
    requestTransform();
  });


  // 出力設定

  ratioSelect.addEventListener("change", function() {

    customSizeArea.style.display =
      this.value === "custom"
        ? "block"
        : "none";

    if (this.value === "custom") {
      document.querySelector(
        'input[name="orientation"][value="auto"]'
      ).checked = true;

      orientationGroup.style.opacity = "0.4";
      orientationGroup.style.pointerEvents = "none";
    } else {
      orientationGroup.style.opacity = "1";
      orientationGroup.style.pointerEvents = "";
    }

    requestTransform();
  });

  customWidth.addEventListener(
    "input", 
    requestTransform
  );

  customHeight.addEventListener(
    "input", 
    requestTransform
  );

  document
    .querySelectorAll('input[name="orientation"]')
    .forEach(radio => {
      radio.addEventListener(
        "change",
        requestTransform
      );
    });


  // 表示設定

  zoomSelect.addEventListener("change", function() {
    zoomScale = parseFloat(this.value);
    updateZoom();
  });

  document
    .querySelectorAll('input[name="theme"]')
    .forEach(radio => {
      radio.addEventListener("change", function () {
        const theme = this.value;

        document.body.classList.remove(
          "theme-default",
          "theme-light",
          "theme-dark"
        );

        document.body.classList.add(
          "theme-" + theme
        );

        if (theme === "dark") {
          logo.src =
            "images/rectly-logo-light.svg"
        } else {
          logo.src =
            "images/rectly-logo.svg";
        }

        draw();
        requestTransform();
      });
    });
}
