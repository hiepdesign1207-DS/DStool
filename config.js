// config.js
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDQ-kANczpQl24kh8PGd6t7WyBLLjaLChQ",
  authDomain: "dstool-8df91.firebaseapp.com",
  projectId: "dstool-8df91",
  storageBucket: "dstool-8df91.firebasestorage.app",
  messagingSenderId: "715762486167",
  appId: "1:715762486167:web:b8e72e1110c9a7d4f852d2"
};

export function isConfigured(cfg) {
  cfg = cfg || FIREBASE_CONFIG;
  return !!(cfg.apiKey && cfg.projectId && String(cfg.apiKey).indexOf('DÁN_') !== 0 && String(cfg.projectId).indexOf('DÁN_') !== 0);
}
