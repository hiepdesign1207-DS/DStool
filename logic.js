// logic.js
// Toàn bộ hàm nghiệp vụ THUẦN (không đụng DOM, không đụng Firebase, không đụng camera) —
// để có thể test bằng Node trực tiếp, và dùng lại y hệt trong app.js chạy trên trình duyệt.
// Dùng ES module (import/export) vì app.js và index.html cũng dùng type="module".

export const STAGES = ['Chưa sản xuất', 'Đã cắt', 'Đã dán cạnh / khoan', 'Đã đóng gói', 'Đã lắp đặt'];

export const CATEGORIES = [
  { name: 'Khung', keywords: ['hồi', 'đáy', 'nóc', 'vách', 'đợt', 'ốp'] },
  { name: 'Hậu', keywords: ['hậu', 'lưng'] },
  { name: 'Nẹp', keywords: ['nẹp', 'phào'] },
  { name: 'Cánh', keywords: ['cánh', 'cửa'] }
];

export function stripDiacritics(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}
export function normalize(str) {
  return stripDiacritics(String(str || '')).toLowerCase().trim();
}
export function classify(name) {
  var n = normalize(name);
  for (var i = 0; i < CATEGORIES.length; i++) {
    var kws = CATEGORIES[i].keywords;
    for (var j = 0; j < kws.length; j++) {
      if (n.indexOf(normalize(kws[j])) !== -1) return { name: CATEGORIES[i].name, index: i };
    }
  }
  return { name: 'Khác', index: -1 };
}

export function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase();
}

// ---------- trạng thái sản xuất / lắp đặt từng tấm ----------
export function clampStage(idx, stages) {
  stages = stages || STAGES;
  return Math.max(0, Math.min(stages.length - 1, idx | 0));
}
export function nextStage(stage, stages) { return clampStage((stage | 0) + 1, stages); }
export function prevStage(stage, stages) { return clampStage((stage | 0) - 1, stages); }

// ---------- tiến độ tổng thể ----------
// progress "có trọng số": một tấm ở giữa chừng (vd: đã cắt, trên tổng 4 bước) vẫn được tính một phần,
// không phải chỉ đếm tấm đã lắp xong — vì xưởng cần biết cả tiến độ SẢN XUẤT, không chỉ LẮP ĐẶT.
export function computeProgress(panels, stages) {
  stages = stages || STAGES;
  var maxIdx = stages.length - 1;
  var byStage = stages.map(function () { return 0; });
  var defectCount = 0;
  panels.forEach(function (p) {
    var s = clampStage(p.stage || 0, stages);
    byStage[s]++;
    if (p.defect) defectCount++;
  });
  var total = panels.length;
  var weightedSum = byStage.reduce(function (sum, count, idx) { return sum + count * idx; }, 0);
  var weightedPercent = total && maxIdx ? Math.round((weightedSum / (total * maxIdx)) * 100) : 0;
  var installedPercent = total ? Math.round((byStage[maxIdx] / total) * 100) : 0;
  return { total: total, byStage: byStage, weightedPercent: weightedPercent, installedPercent: installedPercent, defectCount: defectCount };
}

// ---------- checklist lắp đặt theo công trình ----------
export function defaultChecklist() {
  var items = [
    'Kiểm tra mặt bằng trước khi lắp',
    'Lắp khung / vỏ tủ chính',
    'Lắp vách ngăn, đợt',
    'Lắp cánh, ngăn kéo',
    'Lắp phụ kiện (tay nắm, ray, bản lề)',
    'Chỉnh cánh, cân chỉnh tổng thể',
    'Dọn dẹp, vệ sinh khu vực lắp đặt',
    'Chụp ảnh nghiệm thu, bàn giao'
  ];
  return items.map(function (text, i) { return { id: 'c' + (i + 1), text: text, done: false }; });
}
export function checklistProgress(items) {
  var total = items.length;
  var done = items.filter(function (it) { return it.done; }).length;
  return { done: done, total: total, percent: total ? Math.round((done / total) * 100) : 0 };
}

// ---------- nhập file .json xuất từ xuat_model_tim_tam.rb ----------
// Trả về {projectName, panels[]} đã chuẩn hoá, hoặc throw Error với thông báo tiếng Việt dễ hiểu
// để app.js hiển thị thẳng cho người dùng (không cần dịch lỗi kỹ thuật).
export function parseExportedJson(data) {
  if (!data || !Array.isArray(data.panels) || !data.panels.length) {
    throw new Error('File JSON không có danh sách "panels" hợp lệ.');
  }
  var panels = data.panels.map(function (p) {
    var code = normalizeCode(p.code);
    var cat = classify(p.name || '');
    return {
      code: code,
      name: p.name || '(không tên)',
      category: cat.name,
      catIndex: cat.index,
      box: {
        x: +p.x || 0, y: +p.y || 0, z: +p.z || 0,
        dx: Math.max(+p.dx || 0, 1), dy: Math.max(+p.dy || 0, 1), dz: Math.max(+p.dz || 0, 1)
      },
      stage: 0,
      defect: false,
      defectNote: '',
      notes: []
    };
  }).filter(function (p) { return p.code; });

  if (!panels.length) {
    throw new Error('File có ' + data.panels.length + ' mục nhưng không mục nào có mã tem hợp lệ.');
  }
  return {
    projectName: (data.project && String(data.project).trim()) || 'Công trình chưa đặt tên',
    panels: panels
  };
}

export function dimsText(p) {
  if (!p || !p.box) return '';
  var b = p.box;
  return Math.round(b.dx) + '×' + Math.round(b.dz) + ' mm (cao ' + Math.round(b.dy) + ')';
}

// ---------- ảnh ghi chú: tính kích thước thu nhỏ trước khi nén thành base64 ----------
// Firestore giới hạn 1 document = 1 MiB, nên ảnh phải được thu nhỏ (resize) trước khi lưu kèm ghi chú.
// Hàm này THUẦN (không đụng canvas thật) — app.js sẽ dùng kết quả {width,height} để vẽ lại ảnh lên canvas rồi export JPEG chất lượng thấp.
export function clampImageDimensions(width, height, maxDim) {
  maxDim = maxDim || 900;
  width = Math.max(1, width | 0); height = Math.max(1, height | 0);
  if (width <= maxDim && height <= maxDim) return { width: width, height: height };
  var scale = width >= height ? maxDim / width : maxDim / height;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// ---------- tra cứu khi quét mã (dùng chung cho camera lẫn gõ tay) ----------
export function lookupPanel(rawCode, byCode) {
  var code = normalizeCode(rawCode);
  if (!code) return { code: code, panel: null };
  return { code: code, panel: byCode[code] || null };
}
