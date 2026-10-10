// data-local.js
// Lớp dữ liệu CHẾ ĐỘ DEMO: lưu trong localStorage của chính trình duyệt, không cần tài khoản,
// không đồng bộ nhiều máy. Dùng khi chưa dán cấu hình Firebase vào config.js — để người dùng
// bấm vào là dùng thử được ngay, và cũng là lớp dữ liệu dùng khi kiểm thử giao diện (Playwright)
// mà không cần một dự án Firebase thật.
//
// Đây là phần "giả lập" bên trong khớp interface với data-firebase.js (xem comment đầu file đó):
// listProjects, createProject, importPanels, subscribePanels, setPanelStage, setPanelDefect,
// addPanelNote, subscribeChecklist, setChecklistItem, addChecklistItem, removeChecklistItem,
// ensureChecklist — mỗi hàm subscribe* trả về một hàm unsubscribe.

import { defaultChecklist } from './logic.js';

var STORAGE_KEY = 'ttapp_demo_v1';

function load() {
  try {
    var raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { projects: {}, panels: {}, checklist: {} };
    var data = JSON.parse(raw);
    return { projects: data.projects || {}, panels: data.panels || {}, checklist: data.checklist || {} };
  } catch (e) {
    return { projects: {}, panels: {}, checklist: {} };
  }
}
function save(data) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* quota hoặc private mode — bỏ qua, demo mode không bắt buộc phải lưu được */ }
}
function genId(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

export function createLocalDataLayer() {
  var data = load();
  var listeners = { projects: [] }; // projects: [] ; panels: {projectId:[fns]} ; checklist: {projectId:[fns]}
  var panelListeners = {}, checklistListeners = {};

  function emitProjects() {
    var list = Object.keys(data.projects).map(function (id) { return data.projects[id]; })
      .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    listeners.projects.forEach(function (fn) { fn(list); });
  }
  function emitPanels(projectId) {
    var map = data.panels[projectId] || {};
    var list = Object.keys(map).map(function (code) { return map[code]; }).sort(function (a, b) { return a.code < b.code ? -1 : 1; });
    (panelListeners[projectId] || []).forEach(function (fn) { fn(list); });
  }
  function emitChecklist(projectId) {
    var list = data.checklist[projectId] || [];
    (checklistListeners[projectId] || []).forEach(function (fn) { fn(list); });
  }

  return {
    mode: 'demo',
    ready: Promise.resolve(null),

    listProjects: function (cb) {
      listeners.projects.push(cb);
      emitProjects();
      return function () { listeners.projects = listeners.projects.filter(function (f) { return f !== cb; }); };
    },

    createProject: function (name) {
      var id = genId('proj');
      data.projects[id] = { id: id, name: name || 'Công trình chưa đặt tên', createdAt: Date.now() };
      data.panels[id] = {};
      data.checklist[id] = defaultChecklist();
      save(data);
      emitProjects();
      return Promise.resolve(id);
    },

    importPanels: function (projectId, panels) {
      var map = data.panels[projectId] || {};
      panels.forEach(function (p) { map[p.code] = p; });
      data.panels[projectId] = map;
      save(data);
      emitPanels(projectId);
      return Promise.resolve();
    },

    subscribePanels: function (projectId, cb) {
      panelListeners[projectId] = panelListeners[projectId] || [];
      panelListeners[projectId].push(cb);
      emitPanels(projectId);
      return function () { panelListeners[projectId] = panelListeners[projectId].filter(function (f) { return f !== cb; }); };
    },

    setPanelStage: function (projectId, code, stage) {
      var p = (data.panels[projectId] || {})[code];
      if (!p) return Promise.resolve();
      p.stage = stage;
      save(data);
      emitPanels(projectId);
      return Promise.resolve();
    },

    setPanelDefect: function (projectId, code, defect, note) {
      var p = (data.panels[projectId] || {})[code];
      if (!p) return Promise.resolve();
      p.defect = !!defect;
      p.defectNote = note || '';
      save(data);
      emitPanels(projectId);
      return Promise.resolve();
    },

    addPanelNote: function (projectId, code, note) {
      var p = (data.panels[projectId] || {})[code];
      if (!p) return Promise.resolve();
      p.notes = p.notes || [];
      p.notes.unshift({ text: note.text || '', photo: note.photo || null, createdAt: Date.now() });
      save(data);
      emitPanels(projectId);
      return Promise.resolve();
    },

    subscribeChecklist: function (projectId, cb) {
      checklistListeners[projectId] = checklistListeners[projectId] || [];
      checklistListeners[projectId].push(cb);
      emitChecklist(projectId);
      return function () { checklistListeners[projectId] = checklistListeners[projectId].filter(function (f) { return f !== cb; }); };
    },

    ensureChecklist: function (projectId) {
      if (!data.checklist[projectId] || !data.checklist[projectId].length) {
        data.checklist[projectId] = defaultChecklist();
        save(data);
        emitChecklist(projectId);
      }
      return Promise.resolve();
    },

    setChecklistItem: function (projectId, itemId, done) {
      var items = data.checklist[projectId] || [];
      var it = items.filter(function (i) { return i.id === itemId; })[0];
      if (it) it.done = !!done;
      save(data);
      emitChecklist(projectId);
      return Promise.resolve();
    },

    addChecklistItem: function (projectId, text) {
      data.checklist[projectId] = data.checklist[projectId] || [];
      data.checklist[projectId].push({ id: genId('c'), text: text, done: false });
      save(data);
      emitChecklist(projectId);
      return Promise.resolve();
    },

    removeChecklistItem: function (projectId, itemId) {
      data.checklist[projectId] = (data.checklist[projectId] || []).filter(function (i) { return i.id !== itemId; });
      save(data);
      emitChecklist(projectId);
      return Promise.resolve();
    }
  };
}
