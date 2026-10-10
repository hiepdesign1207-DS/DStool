// data-firebase.js
// Lớp dữ liệu THẬT: đồng bộ nhiều người, nhiều thiết bị, theo thời gian thực, qua Firebase
// Firestore (gói miễn phí Spark — xem tài liệu hướng dẫn phần "Giới hạn của gói miễn phí").
// Chỉ được app.js import (động, bằng import()) KHI config.js đã có cấu hình thật — nếu chưa,
// app.js dùng data-local.js (chế độ demo) và file này không bao giờ được tải, nên không cần
// mạng/tài khoản Firebase để DÙNG THỬ app.
//
// Cùng interface với data-local.js: listProjects, createProject, importPanels, subscribePanels,
// setPanelStage, setPanelDefect, addPanelNote, subscribeChecklist, setChecklistItem,
// addChecklistItem, removeChecklistItem, ensureChecklist.

import { defaultChecklist } from './logic.js';

var SDK = '13.0.0';
var BASE = 'https://www.gstatic.com/firebasejs/' + SDK + '/';

export async function createFirebaseDataLayer(config) {
  var [{ initializeApp }, authMod, fsMod] = await Promise.all([
    import(/* @vite-ignore */ BASE + 'firebase-app.js'),
    import(/* @vite-ignore */ BASE + 'firebase-auth.js'),
    import(/* @vite-ignore */ BASE + 'firebase-firestore.js')
  ]);
  var { getAuth, signInAnonymously, onAuthStateChanged } = authMod;
  var {
    getFirestore, collection, doc, setDoc, updateDoc, onSnapshot, query, orderBy,
    serverTimestamp, writeBatch, deleteDoc, arrayUnion
  } = fsMod;

  var app = initializeApp(config);
  var auth = getAuth(app);
  var db = getFirestore(app);

  var ready = new Promise(function (resolve, reject) {
    var unsub = onAuthStateChanged(auth, function (user) {
      if (user) { unsub(); resolve(user); }
    }, reject);
    signInAnonymously(auth).catch(reject);
  });

  function genId(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

  return {
    mode: 'firebase',
    ready: ready,

    listProjects: function (cb) {
      var q = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
      return onSnapshot(q, function (snap) {
        cb(snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }));
      }, function (err) { console.error('listProjects lỗi:', err); cb([]); });
    },

    createProject: async function (name) {
      await ready;
      var id = genId('proj');
      await setDoc(doc(db, 'projects', id), { name: name || 'Công trình chưa đặt tên', createdAt: Date.now() });
      var batch = writeBatch(db);
      defaultChecklist().forEach(function (item, i) {
        batch.set(doc(db, 'projects', id, 'checklist', item.id), { text: item.text, done: false, order: i });
      });
      await batch.commit();
      return id;
    },

    importPanels: async function (projectId, panels) {
      await ready;
      // Firestore giới hạn 500 thao tác / batch — chia nhỏ cho an toàn với công trình nhiều tấm.
      for (var i = 0; i < panels.length; i += 400) {
        var chunk = panels.slice(i, i + 400);
        var batch = writeBatch(db);
        chunk.forEach(function (p) {
          batch.set(doc(db, 'projects', projectId, 'panels', p.code), {
            name: p.name, category: p.category, catIndex: p.catIndex, box: p.box,
            stage: p.stage || 0, defect: !!p.defect, defectNote: p.defectNote || '', notes: p.notes || [],
            updatedAt: Date.now()
          });
        });
        await batch.commit();
      }
    },

    subscribePanels: function (projectId, cb) {
      return onSnapshot(collection(db, 'projects', projectId, 'panels'), function (snap) {
        cb(snap.docs.map(function (d) { return Object.assign({ code: d.id }, d.data()); }).sort(function (a, b) { return a.code < b.code ? -1 : 1; }));
      }, function (err) { console.error('subscribePanels lỗi:', err); cb([]); });
    },

    setPanelStage: async function (projectId, code, stage) {
      await ready;
      await updateDoc(doc(db, 'projects', projectId, 'panels', code), { stage: stage, updatedAt: Date.now() });
    },

    setPanelDefect: async function (projectId, code, defect, note) {
      await ready;
      await updateDoc(doc(db, 'projects', projectId, 'panels', code), { defect: !!defect, defectNote: note || '', updatedAt: Date.now() });
    },

    addPanelNote: async function (projectId, code, note) {
      await ready;
      await updateDoc(doc(db, 'projects', projectId, 'panels', code), {
        notes: arrayUnion({ text: note.text || '', photo: note.photo || null, createdAt: Date.now() }),
        updatedAt: Date.now()
      });
    },

    subscribeChecklist: function (projectId, cb) {
      var q = query(collection(db, 'projects', projectId, 'checklist'), orderBy('order', 'asc'));
      return onSnapshot(q, function (snap) {
        cb(snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }));
      }, function (err) { console.error('subscribeChecklist lỗi:', err); cb([]); });
    },

    ensureChecklist: async function (projectId) {
      await ready; // tạo lúc createProject rồi; hàm này chỉ để khớp interface với data-local.js
    },

    setChecklistItem: async function (projectId, itemId, done) {
      await ready;
      await updateDoc(doc(db, 'projects', projectId, 'checklist', itemId), { done: !!done });
    },

    addChecklistItem: async function (projectId, text) {
      await ready;
      var id = genId('c');
      await setDoc(doc(db, 'projects', projectId, 'checklist', id), { text: text, done: false, order: Date.now() });
    },

    removeChecklistItem: async function (projectId, itemId) {
      await ready;
      await deleteDoc(doc(db, 'projects', projectId, 'checklist', itemId));
    }
  };
}
