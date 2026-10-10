// app.js — giao diện + nối dây sự kiện. Logic nghiệp vụ thuần nằm ở logic.js (test riêng được).
import {
  STAGES, computeProgress, checklistProgress, parseExportedJson, dimsText,
  clampImageDimensions, nextStage, lookupPanel, normalizeCode
} from './logic.js';
import { FIREBASE_CONFIG, isConfigured } from './config.js';
import { createLocalDataLayer } from './data-local.js';

var STAGE_COLORS = ['var(--ink-muted)', 'var(--cat-1)', 'var(--cat-4)', 'var(--cat-3)', 'var(--status-good)'];
function stageColor(i) { return STAGE_COLORS[Math.max(0, Math.min(STAGE_COLORS.length - 1, i))]; }

function $(id) { return document.getElementById(id); }
function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
function escapeAttr(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

var state = {
  dataLayer: null,
  projects: [],
  currentProjectId: null,
  currentProjectName: '',
  panels: [], byCode: {},
  unsubPanels: null,
  checklist: [],
  unsubChecklist: null,
  stageFilter: -1, // -1 = tất cả
  detailCode: null, // mã tấm đang mở trong overlay chi tiết (null = overlay đang đóng)
  scanner: { stream: null, raf: null, lastCode: null, lastAt: 0 },
  pendingImportTargetProjectId: null // nếu khác null, file .json tiếp theo được nạp THÊM vào công trình này thay vì tạo mới
};

// ---------- khởi động ----------
async function init() {
  if (isConfigured(FIREBASE_CONFIG)) {
    try {
      var mod = await import('./data-firebase.js');
      state.dataLayer = await mod.createFirebaseDataLayer(FIREBASE_CONFIG);
      await state.dataLayer.ready;
    } catch (e) {
      console.error('Không kết nối được Firebase, chuyển sang chế độ demo cục bộ:', e);
      showDemoBanner('Không kết nối được tới Firebase (kiểm tra lại mạng hoặc cấu hình trong config.js). Đang chạy tạm ở chế độ demo cục bộ — dữ liệu chỉ lưu trên máy này.');
      state.dataLayer = createLocalDataLayer();
    }
  } else {
    showDemoBanner('Đang chạy ở CHẾ ĐỘ DEMO CỤC BỘ — dùng thử thoải mái, nhưng dữ liệu chỉ lưu trên trình duyệt này, không đồng bộ với người khác. Xem tài liệu hướng dẫn để bật đồng bộ nhiều người thật.');
    state.dataLayer = createLocalDataLayer();
  }

  state.dataLayer.listProjects(function (list) {
    state.projects = list;
    if ($('screenHome').hidden === false) renderProjectList();
  });

  wireHome();
  wireScanner();
  wireDetailOverlay();
  showHome();
}

function showDemoBanner(text) {
  var b = $('demoBanner');
  b.hidden = false;
  b.textContent = text;
}

// ---------- điều hướng ----------
function showHome() {
  unsubscribeProject();
  state.currentProjectId = null;
  $('screenHome').hidden = false;
  $('screenProject').hidden = true;
  renderProjectList();
}

function showProject(projectId) {
  unsubscribeProject();
  state.currentProjectId = projectId;
  var proj = state.projects.filter(function (p) { return (p.id || p.projectId) === projectId; })[0];
  state.currentProjectName = proj ? proj.name : '';
  $('projectTitle').textContent = state.currentProjectName;
  $('screenHome').hidden = true;
  $('screenProject').hidden = false;
  state.stageFilter = -1;

  state.dataLayer.ensureChecklist(projectId);
  state.unsubPanels = state.dataLayer.subscribePanels(projectId, function (panels) {
    state.panels = panels;
    state.byCode = {};
    panels.forEach(function (p) { state.byCode[p.code] = p; });
    renderDashboard();
    renderPanelList();
    // nếu đang mở chi tiết đúng tấm vừa đổi (vd: vừa quét xong một mã khác rồi quay lại xem),
    // vẽ lại overlay để không hiển thị trạng thái/ghi chú cũ đã lỗi thời
    if (state.detailCode && state.byCode[state.detailCode]) renderPanelDetail(state.detailCode);
  });
  state.unsubChecklist = state.dataLayer.subscribeChecklist(projectId, function (items) {
    state.checklist = items;
    renderChecklist();
  });
}

function unsubscribeProject() {
  if (state.unsubPanels) { state.unsubPanels(); state.unsubPanels = null; }
  if (state.unsubChecklist) { state.unsubChecklist(); state.unsubChecklist = null; }
}

// ---------- trang chủ: danh sách công trình ----------
function renderProjectList() {
  var box = $('projectList');
  if (!state.projects.length) {
    box.innerHTML = '<p class="empty-hint">Chưa có công trình nào — bấm "+ Công trình mới" hoặc nhập trực tiếp từ file SketchUp.</p>';
    return;
  }
  box.innerHTML = '';
  state.projects.forEach(function (p) {
    var card = el('div', 'projectcard');
    card.innerHTML = '<div><div class="name">' + escapeAttr(p.name) + '</div><div class="meta">' + escapeAttr(p.id) + '</div></div><div>&rsaquo;</div>';
    card.addEventListener('click', function () { showProject(p.id); });
    box.appendChild(card);
  });
}

function wireHome() {
  $('newProjectBtn').addEventListener('click', async function () {
    var name = window.prompt('Tên công trình (vd: Tủ bếp nhà anh Nam):', '');
    if (name === null) return;
    var id = await state.dataLayer.createProject(name.trim());
    showProject(id);
  });
  $('importNewBtn').addEventListener('click', function () {
    state.pendingImportTargetProjectId = null; // null = tạo công trình mới từ file này
    $('importInput').click();
  });
  $('importInput').addEventListener('change', function (e) { handleImportFile(e, /*toExistingProject*/ null); });

  $('backHomeBtn').addEventListener('click', showHome);
  $('importMoreBtn').addEventListener('click', function () { $('importMoreInput').click(); });
  $('importMoreInput').addEventListener('change', function (e) { handleImportFile(e, state.currentProjectId); });

  $('addCliBtn').addEventListener('click', async function () {
    var text = $('newCliText').value.trim();
    if (!text) return;
    await state.dataLayer.addChecklistItem(state.currentProjectId, text);
    $('newCliText').value = '';
  });
  $('newCliText').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('addCliBtn').click(); });
}

async function handleImportFile(e, toExistingProjectId) {
  var file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  var reader = new FileReader();
  reader.onload = async function () {
    var parsed;
    try {
      parsed = parseExportedJson(JSON.parse(reader.result));
    } catch (err) {
      window.alert('Không đọc được file này: ' + err.message);
      return;
    }
    var projectId = toExistingProjectId;
    if (!projectId) projectId = await state.dataLayer.createProject(parsed.projectName);
    await state.dataLayer.importPanels(projectId, parsed.panels);
    showToast('Đã nạp ' + parsed.panels.length + ' tấm');
    showProject(projectId);
  };
  reader.onerror = function () { window.alert('Không đọc được file này.'); };
  reader.readAsText(file);
}

// ---------- dashboard ----------
function renderDashboard() {
  var prog = computeProgress(state.panels, STAGES);
  $('progWeightedPct').textContent = prog.weightedPercent + '%';
  $('progWeighted').style.width = prog.weightedPercent + '%';
  $('progInstalledPct').textContent = prog.installedPercent + '%';
  $('progInstalled').style.width = prog.installedPercent + '%';

  var bars = $('stageBars'); bars.innerHTML = '';
  var maxCount = Math.max.apply(null, prog.byStage.concat([1]));
  STAGES.forEach(function (label, i) {
    var bar = el('div', 'bar');
    var h = Math.round((prog.byStage[i] / maxCount) * 100);
    bar.innerHTML = '<span class="count">' + prog.byStage[i] + '</span><div style="height:' + Math.max(h, 4) + '%;background:' + stageColor(i) + '"></div>';
    bars.appendChild(bar);
  });
  var legend = $('stageLegend'); legend.innerHTML = '';
  STAGES.forEach(function (label, i) {
    var item = el('span', 'item');
    item.innerHTML = '<span class="dot" style="background:' + stageColor(i) + '"></span>' + escapeAttr(label);
    legend.appendChild(item);
  });

  var defectBox = $('defectBanner');
  defectBox.innerHTML = prog.defectCount
    ? '<div class="defectflag">⚠ ' + prog.defectCount + ' tấm đang bị đánh dấu lỗi</div>'
    : '';

  renderStageFilterRow(prog);
}

function renderStageFilterRow(prog) {
  var row = $('stageFilterRow'); row.innerHTML = '';
  var all = el('button', 'filterchip' + (state.stageFilter === -1 ? ' active' : ''));
  all.type = 'button'; all.textContent = 'Tất cả (' + state.panels.length + ')';
  all.addEventListener('click', function () { state.stageFilter = -1; renderPanelList(); renderStageFilterRow(prog); });
  row.appendChild(all);
  STAGES.forEach(function (label, i) {
    var chip = el('button', 'filterchip' + (state.stageFilter === i ? ' active' : ''));
    chip.type = 'button'; chip.textContent = label + ' (' + prog.byStage[i] + ')';
    chip.addEventListener('click', function () { state.stageFilter = i; renderPanelList(); renderStageFilterRow(prog); });
    row.appendChild(chip);
  });
}

function renderPanelList() {
  $('panelCount').textContent = state.panels.length;
  var list = state.stageFilter === -1 ? state.panels : state.panels.filter(function (p) { return (p.stage || 0) === state.stageFilter; });
  var box = $('panelList');
  if (!list.length) {
    box.innerHTML = '<p class="empty-hint">Không có tấm nào ở mục này.</p>';
    return;
  }
  box.innerHTML = '';
  list.forEach(function (p) {
    var row = el('div', 'row');
    row.innerHTML =
      '<span class="code">' + escapeAttr(p.code) + '</span>' +
      '<div class="info"><div class="pname">' + escapeAttr(p.name) + '</div><div class="pdims">' + dimsText(p) + '</div></div>' +
      (p.defect ? '<span class="defectdot" title="Đang lỗi"></span>' : '') +
      '<span class="stagechip" style="background:' + stageColor(p.stage || 0) + '">' + escapeAttr(STAGES[p.stage || 0]) + '</span>';
    row.addEventListener('click', function () { openPanelDetail(p.code); });
    box.appendChild(row);
  });
}

// ---------- checklist ----------
function renderChecklist() {
  var prog = checklistProgress(state.checklist);
  $('clPct').textContent = prog.percent;
  var box = $('checklistBox');
  if (!state.checklist.length) {
    box.innerHTML = '<p class="empty-hint">Chưa có bước nào.</p>';
    return;
  }
  box.innerHTML = '';
  state.checklist.forEach(function (it) {
    var row = el('div', 'clitem' + (it.done ? ' done' : ''));
    var cb = el('input'); cb.type = 'checkbox'; cb.checked = !!it.done;
    cb.addEventListener('change', function () { state.dataLayer.setChecklistItem(state.currentProjectId, it.id, cb.checked); });
    var txt = el('span', 'text'); txt.textContent = it.text;
    var rm = el('button', 'rm'); rm.type = 'button'; rm.textContent = '✕';
    rm.addEventListener('click', function () { state.dataLayer.removeChecklistItem(state.currentProjectId, it.id); });
    row.appendChild(cb); row.appendChild(txt); row.appendChild(rm);
    box.appendChild(row);
  });
}

// ---------- quét camera ----------
function wireScanner() {
  $('openScannerBtn').addEventListener('click', openScanner);
  $('closeScannerBtn').addEventListener('click', closeScanner);
  $('manualLookupBtn').addEventListener('click', function () { doLookup($('manualCodeInput').value); });
  $('manualCodeInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLookup($('manualCodeInput').value); });
}

async function openScanner() {
  $('scannerOverlay').hidden = false;
  $('scanResultBox').innerHTML = '';
  $('manualCodeInput').value = '';
  $('camStatus').textContent = 'Đang mở camera…';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('camStatus').textContent = 'Trình duyệt này không hỗ trợ camera trực tiếp — dùng ô gõ tay bên dưới.';
    return;
  }
  try {
    var stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    state.scanner.stream = stream;
    var video = $('scanVideo');
    video.srcObject = stream;
    await video.play();
    $('camStatus').textContent = 'Đưa mã QR vào giữa khung hình';
    startDecodeLoop();
  } catch (e) {
    console.error('Không mở được camera:', e);
    $('camStatus').textContent = 'Không mở được camera (có thể bạn chưa cho phép quyền truy cập) — dùng ô gõ tay bên dưới.';
  }
}

function closeScanner() {
  $('scannerOverlay').hidden = true;
  if (state.scanner.raf) { cancelAnimationFrame(state.scanner.raf); state.scanner.raf = null; }
  if (state.scanner.stream) { state.scanner.stream.getTracks().forEach(function (t) { t.stop(); }); state.scanner.stream = null; }
}

function startDecodeLoop() {
  var video = $('scanVideo'), canvas = $('scanCanvas');
  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  function tick() {
    if (!state.scanner.stream) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA && window.jsQR) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var result = window.jsQR(img.data, canvas.width, canvas.height);
      if (result && result.data) {
        var now = Date.now();
        // chặn quét lặp lại liên tục cùng một mã trong 2.5 giây (tránh hiện lại kết quả mỗi khung hình)
        if (result.data !== state.scanner.lastCode || now - state.scanner.lastAt > 2500) {
          state.scanner.lastCode = result.data; state.scanner.lastAt = now;
          doLookup(result.data);
        }
      }
    }
    state.scanner.raf = requestAnimationFrame(tick);
  }
  state.scanner.raf = requestAnimationFrame(tick);
}

function doLookup(rawCode) {
  var r = lookupPanel(rawCode, state.byCode);
  var box = $('scanResultBox');
  if (!r.panel) {
    box.innerHTML = '<div class="scanmiss">⚠ Không tìm thấy tấm với mã "' + escapeAttr(r.code) + '" trong công trình này.</div>';
    return;
  }
  var p = r.panel;
  box.innerHTML =
    '<div class="scanhit">✓ <b>' + escapeAttr(p.code) + '</b> — ' + escapeAttr(p.name) + ' (' + escapeAttr(STAGES[p.stage || 0]) + ')</div>' +
    '<div class="btnrow" style="margin-top:8px;">' +
    '<button class="btn btn-primary" id="scanAdvanceBtn" type="button">Chuyển sang "' + escapeAttr(STAGES[nextStage(p.stage || 0)]) + '"</button>' +
    '<button class="btn" id="scanDetailBtn" type="button">Xem chi tiết</button>' +
    '</div>';
  $('scanAdvanceBtn').addEventListener('click', function () {
    state.dataLayer.setPanelStage(state.currentProjectId, p.code, nextStage(p.stage || 0));
    showToast('Đã cập nhật ' + p.code);
  });
  $('scanDetailBtn').addEventListener('click', function () { closeScanner(); openPanelDetail(p.code); });
}

// ---------- chi tiết tấm ----------
function wireDetailOverlay() {
  $('closeDetailBtn').addEventListener('click', function () { state.detailCode = null; $('panelDetailOverlay').hidden = true; });
}

function openPanelDetail(code) {
  state.detailCode = code;
  renderPanelDetail(code);
  $('panelDetailOverlay').hidden = false;
}

function renderPanelDetail(code) {
  var p = state.byCode[code];
  if (!p) return;
  $('detailTitle').textContent = p.code + ' — ' + p.name;
  var body = $('detailBody');

  var stepsHtml = STAGES.map(function (label, i) {
    var cls = 'stagestep' + (i === (p.stage || 0) ? ' current' : i < (p.stage || 0) ? ' past' : '');
    return '<div class="' + cls + '" data-stage="' + i + '"><span class="dot" style="background:' + stageColor(i) + '">' + (i < (p.stage || 0) ? '✓' : i + 1) + '</span><span class="label">' + escapeAttr(label) + '</span></div>';
  }).join('');

  body.innerHTML =
    '<div class="field"><label>Kích thước</label><div style="font-family:var(--mono);font-size:13px;">' + dimsText(p) + '</div></div>' +
    '<div class="field"><label>Trạng thái sản xuất / lắp đặt</label><div class="stagesteps">' + stepsHtml + '</div></div>' +
    '<div class="field"><label class="toggle"><input type="checkbox" id="defectToggle"' + (p.defect ? ' checked' : '') + '> Đánh dấu tấm này bị lỗi</label></div>' +
    '<div class="field" id="defectNoteField" style="' + (p.defect ? '' : 'display:none;') + '">' +
    '<label>Mô tả lỗi</label><textarea id="defectNoteInput" placeholder="vd: mẻ cạnh, sai kích thước…">' + escapeAttr(p.defectNote || '') + '</textarea>' +
    '<button class="btn btn-danger" id="saveDefectBtn" type="button" style="margin-top:6px;">Lưu lỗi</button></div>' +
    '<div class="field"><label>Thêm ghi chú / ảnh</label>' +
    '<textarea id="noteTextInput" placeholder="Ghi chú cho tấm này…"></textarea>' +
    '<div class="btnrow" style="margin-top:6px;">' +
    '<button class="btn" id="addPhotoBtn" type="button">📷 Thêm ảnh</button>' +
    '<button class="btn btn-primary" id="saveNoteBtn" type="button">Lưu ghi chú</button>' +
    '</div><input type="file" id="photoNoteInput" accept="image/*" capture="environment">' +
    '<div id="pendingPhotoPreview"></div></div>' +
    '<div class="field"><label>Lịch sử ghi chú</label><div id="notesBox"></div></div>';

  body.querySelectorAll('.stagestep').forEach(function (stepEl) {
    stepEl.addEventListener('click', function () {
      var idx = parseInt(stepEl.getAttribute('data-stage'), 10);
      state.dataLayer.setPanelStage(state.currentProjectId, p.code, idx);
      showToast('Đã chuyển ' + p.code + ' sang "' + STAGES[idx] + '"');
    });
  });

  var defectToggle = $('defectToggle');
  defectToggle.addEventListener('change', function () {
    $('defectNoteField').style.display = defectToggle.checked ? '' : 'none';
    if (!defectToggle.checked) state.dataLayer.setPanelDefect(state.currentProjectId, p.code, false, '');
  });
  $('saveDefectBtn').addEventListener('click', function () {
    state.dataLayer.setPanelDefect(state.currentProjectId, p.code, true, $('defectNoteInput').value.trim());
    showToast('Đã lưu ghi chú lỗi');
  });

  var pendingPhoto = null;
  $('addPhotoBtn').addEventListener('click', function () { $('photoNoteInput').click(); });
  $('photoNoteInput').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    resizeImageFile(file, 900, 0.6).then(function (dataUrl) {
      pendingPhoto = dataUrl;
      $('pendingPhotoPreview').innerHTML = '<img src="' + dataUrl + '" style="width:160px;border-radius:6px;margin-top:6px;display:block;background:var(--surface-3);">';
    });
  });
  $('saveNoteBtn').addEventListener('click', async function () {
    var text = $('noteTextInput').value.trim();
    if (!text && !pendingPhoto) return;
    await state.dataLayer.addPanelNote(state.currentProjectId, p.code, { text: text, photo: pendingPhoto });
    $('noteTextInput').value = ''; pendingPhoto = null; $('pendingPhotoPreview').innerHTML = '';
    showToast('Đã lưu ghi chú');
  });

  renderNotes(p);
}

function renderNotes(p) {
  var box = $('notesBox');
  if (!p.notes || !p.notes.length) { box.innerHTML = '<p class="empty-hint">Chưa có ghi chú nào.</p>'; return; }
  box.innerHTML = '';
  p.notes.forEach(function (n) {
    var card = el('div', 'notecard');
    var ts = n.createdAt ? new Date(n.createdAt).toLocaleString('vi-VN') : '';
    card.innerHTML = '<div class="ts">' + escapeAttr(ts) + '</div>' +
      (n.text ? '<div class="txt">' + escapeAttr(n.text) + '</div>' : '') +
      (n.photo ? '<img src="' + n.photo + '">' : '');
    box.appendChild(card);
  });
}

// thu nhỏ + nén ảnh trước khi lưu (giới hạn tài liệu Firestore 1MB/tấm) — dùng canvas thật của trình duyệt,
// phần tính kích thước mục tiêu lấy từ clampImageDimensions() (logic.js, đã test riêng).
function resizeImageFile(file, maxDim, quality) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () {
      var dim = clampImageDimensions(img.width, img.height, maxDim);
      var canvas = document.createElement('canvas');
      canvas.width = dim.width; canvas.height = dim.height;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, dim.width, dim.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ---------- toast ----------
var toastTimer = null;
function showToast(msg) {
  var t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1600);
}

init();
