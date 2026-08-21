// ============================================================
// Branchwork — Mind Mapping App
// Firebase Auth (email/password + Google) + Firestore storage
// with real-time shared editing via an invite code.
// Vanilla JS, no build step.
// ============================================================

import { firebaseConfig, googleClientId } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  GoogleAuthProvider, signInWithCredential, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc, deleteField,
  getDocs, getDoc, onSnapshot, query, where, serverTimestamp, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as htmlToImage from "https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/+esm";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $all = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid4 = () => Math.random().toString(36).slice(2, 10);

function showView(name) {
  ['auth', 'dashboard', 'editor', 'board'].forEach(v => {
    $(`#view-${v}`).hidden = v !== name;
  });
}

// ------------------------------------------------------------
// Theme (light / dark)
// ------------------------------------------------------------
const THEME_KEY = 'bw-theme';
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  $all('.theme-toggle').forEach(btn => {
    btn.textContent = theme === 'light' ? '🌙' : '☀️';
    btn.title = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
  });
}
applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
$all('.theme-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
});

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function makeShareCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// simple deterministic string -> hue, so a branch's color never needs a
// shared counter (which would collide when two people add branches at once)
function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}

// ============================================================
// AUTH VIEW
// ============================================================
let authMode = 'signin';

$all('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    authMode = tab.dataset.mode;
    $all('.auth-tab').forEach(t => t.classList.toggle('is-active', t === tab));
    $('#auth-submit').textContent = authMode === 'signin' ? 'Sign in' : 'Create account';
    $('#auth-error').hidden = true;
  });
});

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#auth-email').value.trim();
  const password = $('#auth-password').value;
  const errEl = $('#auth-error');
  errEl.hidden = true;
  $('#auth-submit').disabled = true;
  try {
    if (authMode === 'signin') {
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      await createUserWithEmailAndPassword(auth, email, password);
    }
  } catch (err) {
    errEl.textContent = friendlyAuthError(err);
    errEl.hidden = false;
  } finally {
    $('#auth-submit').disabled = false;
  }
});

// ------------------------------------------------------------
// Google sign-in via Google Identity Services (GIS), not Firebase's
// own popup/redirect flow. GIS uses Chrome's FedCM mechanism, which
// is built to keep working even when third-party storage/cookies
// are blocked — the exact thing that breaks Firebase's own popup
// and redirect flows on static hosts like GitHub Pages.
// ------------------------------------------------------------
async function handleGoogleCredential(response) {
  const errEl = $('#auth-error');
  errEl.hidden = true;
  try {
    const credential = GoogleAuthProvider.credential(response.credential);
    await signInWithCredential(auth, credential);
  } catch (err) {
    errEl.textContent = friendlyAuthError(err);
    errEl.hidden = false;
  }
}

function waitForGoogleIdentity(cb, triesLeft = 50) {
  if (window.google && window.google.accounts && window.google.accounts.id) { cb(); return; }
  if (triesLeft <= 0) { $('#google-btn-fallback').hidden = false; return; }
  setTimeout(() => waitForGoogleIdentity(cb, triesLeft - 1), 100);
}

waitForGoogleIdentity(() => {
  google.accounts.id.initialize({
    client_id: googleClientId,
    callback: handleGoogleCredential,
    ux_mode: 'popup'
  });
  google.accounts.id.renderButton(
    $('#google-btn-container'),
    { theme: 'outline', size: 'large', width: 324, text: 'continue_with' }
  );
});

function friendlyAuthError(err) {
  const code = err.code || '';
  if (code.includes('email-already-in-use')) return 'That email already has an account — try signing in instead.';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Email or password is incorrect.';
  if (code.includes('weak-password')) return 'Password must be at least 6 characters.';
  if (code.includes('invalid-email')) return 'That email address looks invalid.';
  if (code.includes('unauthorized-domain')) return "This domain isn't authorized for Google sign-in yet — add it in Firebase Console → Authentication → Settings.";
  if (code.includes('popup-blocked')) return 'Your browser blocked the sign-in popup. Please allow popups and try again.';
  return 'Something went wrong. Please try again.';
}

$('#btn-logout').addEventListener('click', () => signOut(auth));

// ============================================================
// AUTH STATE → route to dashboard or auth screen
// ============================================================
let currentUser = null;

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  stopAutosaveLoop();
  stopMapListener();
  if (user) {
    $('#dash-email').textContent = user.email || user.displayName || 'Signed in';
    showView('dashboard');
    loadDashboard();
    openJoinModalFromLink();
  } else {
    showView('auth');
  }
});

// If the user arrived via an invite link (…?code=XXXX), open the join
// modal pre-filled with that code instead of making them type it in.
function openJoinModalFromLink() {
  const code = new URLSearchParams(location.search).get('code');
  if (!code) return;
  history.replaceState(null, '', location.pathname);
  $('#join-code-input').value = code.trim().toUpperCase();
  $('#join-error').hidden = true;
  $('#join-modal').hidden = false;
}

// ============================================================
// DASHBOARD
// Maps and boards each live in their own top-level collection so
// they can be shared independently. A user sees an item if they
// are the owner OR listed in its `collaborators` array. The
// dashboard queries both collections and merges them into one list.
// ============================================================
function mapsCollection() {
  return collection(db, 'maps');
}
function boardsCollection() {
  return collection(db, 'boards');
}

async function loadDashboard() {
  const grid = $('#dash-grid');
  grid.innerHTML = '<p style="color:var(--text-lo); font-size:13px;">Loading…</p>';
  try {
    const [mapOwned, mapShared, boardOwned, boardShared] = await Promise.all([
      getDocs(query(mapsCollection(), where('ownerId', '==', currentUser.uid))),
      getDocs(query(mapsCollection(), where('collaborators', 'array-contains', currentUser.uid))),
      getDocs(query(boardsCollection(), where('ownerId', '==', currentUser.uid))),
      getDocs(query(boardsCollection(), where('collaborators', 'array-contains', currentUser.uid)))
    ]);

    const seen = new Map(); // id -> { data, kind }
    mapOwned.forEach(d => seen.set('map:' + d.id, { id: d.id, data: d.data(), kind: 'map' }));
    mapShared.forEach(d => { if (!seen.has('map:' + d.id)) seen.set('map:' + d.id, { id: d.id, data: d.data(), kind: 'map' }); });
    boardOwned.forEach(d => seen.set('board:' + d.id, { id: d.id, data: d.data(), kind: 'board' }));
    boardShared.forEach(d => { if (!seen.has('board:' + d.id)) seen.set('board:' + d.id, { id: d.id, data: d.data(), kind: 'board' }); });

    grid.innerHTML = '';
    if (seen.size === 0) {
      $('#dash-empty').hidden = false;
      return;
    }
    $('#dash-empty').hidden = true;

    const entries = Array.from(seen.values()).sort((a, b) => {
      const ta = a.data.updatedAt?.toMillis ? a.data.updatedAt.toMillis() : 0;
      const tb = b.data.updatedAt?.toMillis ? b.data.updatedAt.toMillis() : 0;
      return tb - ta;
    });
    entries.forEach(({ id, data, kind }) => grid.appendChild(renderItemCard(id, data, kind)));
  } catch (err) {
    grid.innerHTML = `<p style="color:var(--danger); font-size:13px;">Couldn't load your workspace: ${escapeHtml(err.message)}</p>`;
  }
}

function renderItemCard(id, data, kind) {
  const card = document.createElement('div');
  card.className = 'map-card';
  const isBoard = kind === 'board';
  const countLabel = isBoard
    ? `${data.cards ? Object.keys(data.cards).length : 0} card${(data.cards ? Object.keys(data.cards).length : 0) === 1 ? '' : 's'}`
    : `${data.nodes ? Object.keys(data.nodes).length : 0} node${(data.nodes ? Object.keys(data.nodes).length : 0) === 1 ? '' : 's'}`;
  const updated = data.updatedAt && data.updatedAt.toDate ? data.updatedAt.toDate() : null;
  const owner = data.ownerId === currentUser.uid;
  const kindLabel = isBoard ? 'Board' : 'Map';
  const badgeLabel = owner ? kindLabel : `Shared ${kindLabel}`;
  card.innerHTML = `
    <div class="map-card-glow" style="background:radial-gradient(circle at 30% 20%, hsl(${isBoard ? 200 : 8} 90% 60%), transparent 70%)"></div>
    <span class="map-card-badge">${badgeLabel}</span>
    <button class="map-card-del" title="${owner ? 'Delete' : 'Leave'}">${owner ? '✕' : '⏏'}</button>
    <h3>${escapeHtml(data.title || (isBoard ? 'Untitled board' : 'Untitled map'))}</h3>
    <div class="map-card-meta">${countLabel} · ${updated ? relativeTime(updated) : 'just now'}</div>
  `;
  card.addEventListener('click', (e) => {
    if (e.target.closest('.map-card-del')) return;
    if (isBoard) openBoard(id); else openMap(id);
  });
  card.querySelector('.map-card-del').addEventListener('click', async (e) => {
    e.stopPropagation();
    const coll = isBoard ? 'boards' : 'maps';
    const label = data.title || (isBoard ? 'Untitled board' : 'Untitled map');
    if (owner) {
      if (!confirm(`Delete "${label}"? This can't be undone.`)) return;
      await deleteDoc(doc(db, coll, id));
    } else {
      if (!confirm(`Leave "${label}"? You'll need a new invite code to rejoin.`)) return;
      await updateDoc(doc(db, coll, id), { collaborators: arrayRemove(currentUser.uid) });
    }
    loadDashboard();
  });
  return card;
}

function relativeTime(date) {
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Full multi-line text for a node's native hover tooltip.
function attributionTooltip(n) {
  let lines = [];
  if (n.createdBy) {
    lines.push(`Added by ${n.createdByName || 'someone'} · ${relativeTime(new Date(n.createdAt))}`);
    if (n.updatedBy && n.updatedAt && n.updatedAt !== n.createdAt) {
      lines.push(`Edited by ${n.updatedByName || 'someone'} · ${relativeTime(new Date(n.updatedAt))}`);
    }
  }
  if (n.note) lines.push(`Note: ${n.note}`);
  return lines.join('\n');
}

// Short single line for the node toolbar — most recent event wins.
function attributionCaption(n) {
  if (!n.createdBy) return null;
  if (n.updatedBy && n.updatedAt && n.updatedAt !== n.createdAt) {
    return `Edited by ${n.updatedByName || 'someone'} · ${relativeTime(new Date(n.updatedAt))}`;
  }
  return `Added by ${n.createdByName || 'someone'} · ${relativeTime(new Date(n.createdAt))}`;
}

$('#btn-new-map').addEventListener('click', async () => {
  const rootId = 'root';
  const newDoc = {
    title: 'Untitled map',
    ownerId: currentUser.uid,
    ownerEmail: currentUser.email || '',
    collaborators: [],
    shareCode: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    rootId,
    nodes: {
      [rootId]: {
        text: 'Central idea', parentId: null, x: 0, y: 0, depth: 0, side: null, branch: null, collapsed: false,
        createdBy: currentUser.uid, createdByName: currentUser.displayName || currentUser.email || 'Someone', createdAt: Date.now()
      }
    }
  };
  const ref = await addDoc(mapsCollection(), newDoc);
  openMap(ref.id);
});

$('#btn-new-board').addEventListener('click', async () => {
  const colIds = ['col_todo', 'col_doing', 'col_done'];
  const newDoc = {
    title: 'Untitled board',
    ownerId: currentUser.uid,
    ownerEmail: currentUser.email || '',
    collaborators: [],
    shareCode: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    columns: {
      [colIds[0]]: { title: 'To Do', order: 0 },
      [colIds[1]]: { title: 'In Progress', order: 1 },
      [colIds[2]]: { title: 'Done', order: 2 }
    },
    cards: {}
  };
  const ref = await addDoc(boardsCollection(), newDoc);
  openBoard(ref.id);
});

$('#btn-back').addEventListener('click', () => {
  stopAutosaveLoop();
  stopMapListener();
  $('#share-panel').hidden = true;
  $('#notes-panel').hidden = true;
  showView('dashboard');
  loadDashboard();
});

$('#btn-board-back').addEventListener('click', () => {
  stopBoardAutosaveLoop();
  stopBoardListener();
  $('#share-panel').hidden = true;
  $('#notes-panel').hidden = true;
  showView('dashboard');
  loadDashboard();
});

// ------------------------------------------------------------
// Join a shared map or board by code
// ------------------------------------------------------------
$('#btn-join-map').addEventListener('click', () => {
  $('#join-code-input').value = '';
  $('#join-error').hidden = true;
  $('#join-modal').hidden = false;
  $('#join-code-input').focus();
});
$('#join-cancel').addEventListener('click', () => { $('#join-modal').hidden = true; });
$('#join-modal').addEventListener('click', (e) => { if (e.target.id === 'join-modal') $('#join-modal').hidden = true; });

$('#join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('#join-code-input').value.trim().toUpperCase();
  const errEl = $('#join-error');
  errEl.hidden = true;
  if (!code) return;
  try {
    let codeSnap = await getDoc(doc(db, 'joinCodes', code));
    let kind = 'map';
    if (!codeSnap.exists()) {
      codeSnap = await getDoc(doc(db, 'boardJoinCodes', code));
      kind = 'board';
    }
    if (!codeSnap.exists()) {
      errEl.textContent = "That code doesn't match any shared map or board.";
      errEl.hidden = false;
      return;
    }
    if (kind === 'map') {
      const { mapId: targetMapId } = codeSnap.data();
      await updateDoc(doc(db, 'maps', targetMapId), { collaborators: arrayUnion(currentUser.uid) });
      $('#join-modal').hidden = true;
      toast('Joined the map');
      openMap(targetMapId);
    } else {
      const { boardId: targetBoardId } = codeSnap.data();
      await updateDoc(doc(db, 'boards', targetBoardId), { collaborators: arrayUnion(currentUser.uid) });
      $('#join-modal').hidden = true;
      toast('Joined the board');
      openBoard(targetBoardId);
    }
  } catch (err) {
    errEl.textContent = "Couldn't join that map or board. Double-check the code and try again.";
    errEl.hidden = false;
  }
});

// ============================================================
// EDITOR — state
// ============================================================
let mapId = null;
let mapData = null;         // { title, ownerId, collaborators, rootId, nodes: {id: {...}} }
let selectedId = null;
let editingId = null;
let draggingId = null;
const draggingSubtreeIds = new Set(); // node + all descendants currently being dragged together
let unsubscribeMap = null;

// Board editor state — kept separate from the map editor's above
// rather than unified, since only one editor is ever open at a time
// and separate state is easier to reason about than shared mutable
// state across two fairly different data shapes.
let boardId = null;
let boardData = null;       // { title, ownerId, collaborators, columns: {id:{...}}, cards: {id:{...}} }
let boardEditingId = null;  // id of the card/column currently being renamed
let boardDraggingCardId = null;
let unsubscribeBoard = null;
let boardPendingWrites = {};
let boardAutosaveInterval = null;

// granular pending writes so autosave never clobbers a collaborator's
// concurrent edits with a stale full-document overwrite
let pendingWrites = {};   // e.g. { 'nodes.abc123': {...}, 'title': 'New title' }

const view = { scale: 1, panX: 0, panY: 0 };
const NODE_SPACING_X = 230;
const SIB_SPACING_Y = 76;

async function openMap(id) {
  mapId = id;
  activeKind = 'map';
  activeId = id;
  const snap = await getDoc(doc(db, 'maps', id));
  if (!snap.exists()) { toast('That map no longer exists.'); showView('dashboard'); loadDashboard(); return; }
  mapData = snap.data();
  if (!mapData.nodes) mapData.nodes = {};
  if (!mapData.collaborators) mapData.collaborators = [];
  selectedId = mapData.rootId;
  editingId = null;
  draggingId = null;
  pendingWrites = {};
  view.scale = 1; view.panX = 0; view.panY = 0;

  $('#map-title-input').value = mapData.title || 'Untitled map';
  $('#share-panel').hidden = true;
  $('#notes-panel').hidden = true;
  updateShareButtonVisibility();
  showView('editor');
  centerView();
  renderAll();
  startAutosaveLoop();
  startMapListener();
}

// Tracks whichever editor (map or board) is currently open, so shared
// UI — the share panel and export button — knows which collection/doc
// to act on without map-specific and board-specific code needing to
// duplicate that logic.
let activeKind = null; // 'map' | 'board'
let activeId = null;
function activeData() { return activeKind === 'board' ? boardData : mapData; }
function activeCollectionName() { return activeKind === 'board' ? 'boards' : 'maps'; }
function activeJoinCodeCollectionName() { return activeKind === 'board' ? 'boardJoinCodes' : 'joinCodes'; }

function isOwner() {
  const d = activeData();
  return d && d.ownerId === currentUser.uid;
}

function updateShareButtonVisibility() {
  const owner = isOwner();
  const label = activeKind === 'board' ? 'board' : 'map';
  const text = owner ? 'Share' : `Shared ${label}`;
  const mapBtn = $('#btn-share'); if (mapBtn) mapBtn.textContent = text;
  const boardBtn = $('#btn-board-share'); if (boardBtn) boardBtn.textContent = text;
}

// ------------------------------------------------------------
// Real-time sync: listen for remote changes and merge them in
// without stepping on whatever the local user is actively doing.
// ------------------------------------------------------------
function startMapListener() {
  stopMapListener();
  unsubscribeMap = onSnapshot(doc(db, 'maps', mapId), (snap) => {
    if (!snap.exists()) {
      toast('This map was deleted by its owner.');
      stopAutosaveLoop(); stopMapListener();
      showView('dashboard'); loadDashboard();
      return;
    }
    // Skip the echo of our own optimistic writes — they're already applied locally.
    if (snap.metadata.hasPendingWrites) return;
    mergeRemoteIntoLocal(snap.data());
  });
}
function stopMapListener() {
  if (unsubscribeMap) unsubscribeMap();
  unsubscribeMap = null;
}

// Generic flat-object field comparison — used for map nodes as well as
// board columns/cards, since all of those are flat objects of primitives.
function nodesEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

function mergeRemoteIntoLocal(remote) {
  if (!mapData) return;
  let needsRender = false;

  if (pendingWrites['title'] === undefined && remote.title !== mapData.title) {
    mapData.title = remote.title;
    if (document.activeElement !== $('#map-title-input')) $('#map-title-input').value = remote.title;
  }
  if (remote.collaborators) {
    mapData.collaborators = remote.collaborators;
    if (!$('#share-panel').hidden) renderShareCollabList();
  }
  if (remote.shareCode !== undefined && pendingWrites['shareCode'] === undefined) {
    mapData.shareCode = remote.shareCode;
    if (!$('#share-panel').hidden) renderSharePanel();
  }

  const remoteNodes = remote.nodes || {};
  const localIds = new Set(Object.keys(mapData.nodes));
  const remoteIds = new Set(Object.keys(remoteNodes));

  for (const id of remoteIds) {
    if (pendingWrites[`nodes.${id}`] !== undefined) continue; // we have an unsynced local edit — ours wins for now
    if (id === editingId || draggingSubtreeIds.has(id)) continue; // actively being touched locally
    const incoming = remoteNodes[id];
    const local = mapData.nodes[id];
    if (!local || !nodesEqual(local, incoming)) {
      mapData.nodes[id] = incoming;
      needsRender = true;
    }
  }
  for (const id of localIds) {
    if (!remoteIds.has(id) && pendingWrites[`nodes.${id}`] === undefined) {
      delete mapData.nodes[id];
      if (selectedId === id) selectedId = mapData.rootId;
      needsRender = true;
    }
  }

  // Never rebuild the DOM while someone's mid-keystroke or mid-drag —
  // renderAll() tears down and recreates every node element, which would
  // yank focus out of a contentEditable node (losing whatever they just
  // typed) or reset a node being dragged. Whatever changed remotely is
  // already sitting in mapData and will show up on the next render once
  // the local edit/drag finishes.
  if (needsRender && !editingId && !draggingId) renderAll();
}

// ------------------------------------------------------------
// Color system: hue per branch, with lightness/saturation shifting
// per depth — color encodes topic, shade encodes level. Any node can
// become a "color anchor" by setting its own hueOverride; its whole
// subtree then shades off that hue instead of the branch default,
// which is found by walking up to the nearest ancestor (or self)
// that has an override, falling back to the branch's hashed hue.
// ------------------------------------------------------------
function resolveColorSource(node) {
  let cur = node;
  while (cur) {
    if (cur.hueOverride !== undefined && cur.hueOverride !== null) {
      return { hue: cur.hueOverride, sourceDepth: cur.depth };
    }
    cur = cur.parentId ? mapData.nodes[cur.parentId] : null;
  }
  return { hue: hashHue(node.branch || 'x'), sourceDepth: 1 };
}

function colorForNode(node) {
  if (node.depth === 0) return { bg: 'var(--paper)', text: '#1c1c1c', stroke: 'var(--paper-dim)' };
  const { hue, sourceDepth } = resolveColorSource(node);
  const rel = Math.max(0, node.depth - sourceDepth);
  // the anchor node itself (rel 0) stays vivid and fairly dark; each
  // level below it steps noticeably lighter and less saturated
  const sat = Math.max(30, 78 - rel * 10);
  const light = Math.min(85, 42 + rel * 12);
  const bg = `hsl(${hue} ${sat}% ${light}%)`;
  const text = light > 58 ? '#1c1c1c' : '#fbfaf7';
  const stroke = `hsl(${hue} ${sat}% ${Math.max(20, light - 18)}%)`;
  return { bg, text, stroke };
}

// ------------------------------------------------------------
// Tree helpers
// ------------------------------------------------------------
function childrenOf(id) {
  return Object.entries(mapData.nodes)
    .filter(([, n]) => n.parentId === id)
    .sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0))
    .map(([nid]) => nid);
}

function relayoutChildren(parentId) {
  const kids = childrenOf(parentId).filter(id => !mapData.nodes[id].manual);
  if (kids.length === 0) return;
  const parent = mapData.nodes[parentId];
  const totalH = (kids.length - 1) * SIB_SPACING_Y;
  const startY = parent.y - totalH / 2;
  kids.forEach((id, i) => {
    const n = mapData.nodes[id];
    const dir = n.side === 'left' ? -1 : 1;
    n.x = parent.x + dir * NODE_SPACING_X;
    n.y = startY + i * SIB_SPACING_Y;
    queueNodeWrite(id);
  });
}

// Builds a single new node under parentId and queues its write, but does
// NOT relayout siblings or mark the map dirty — callers that add just one
// node (addChildNode) or many at once (paste) each decide when to do that,
// so pasting a whole branch doesn't re-center siblings after every node.
function createChildNode(parentId, text = 'New idea', extra = {}) {
  const parent = mapData.nodes[parentId];
  const id = uid4();
  let side, branch;
  if (parent.depth === 0) {
    const rootKids = childrenOf(parentId);
    side = rootKids.length % 2 === 0 ? 'right' : 'left';
    branch = id; // this node defines a brand-new branch/topic color
  } else {
    side = parent.side;
    branch = parent.branch;
  }
  const siblingCount = childrenOf(parentId).length;
  mapData.nodes[id] = {
    text, parentId, depth: parent.depth + 1, side, branch,
    x: parent.x + (side === 'left' ? -NODE_SPACING_X : NODE_SPACING_X),
    y: parent.y + siblingCount * SIB_SPACING_Y,
    collapsed: false, order: siblingCount,
    createdBy: currentUser.uid,
    createdByName: currentUser.displayName || currentUser.email || 'Someone',
    createdAt: Date.now(),
    ...extra
  };
  queueNodeWrite(id);
  return id;
}

function addChildNode(parentId, text = 'New idea') {
  const id = createChildNode(parentId, text);
  relayoutChildren(parentId);
  markMetaDirty();
  return id;
}

function deleteNodeSubtree(id) {
  if (id === mapData.rootId) return;
  const parentId = mapData.nodes[id].parentId;
  const toDelete = [id, ...collectDescendants(id)];
  toDelete.forEach(d => { delete mapData.nodes[d]; queueNodeDelete(d); });
  relayoutChildren(parentId);
  markMetaDirty();
}

function collectDescendants(id) {
  let out = [];
  for (const kid of childrenOf(id)) out.push(kid, ...collectDescendants(kid));
  return out;
}

// ------------------------------------------------------------
// Copy / paste — the clipboard holds a plain-object snapshot of a
// node's subtree (text, amount, color, collapsed state, and nested
// children), stripped of ids/parent/position so it can be pasted
// anywhere, any number of times, as a fresh set of nodes each time.
// Session-local only (not synced) — same lifetime as a system clipboard.
// ------------------------------------------------------------
let clipboardNode = null;

function cloneSubtreeForClipboard(id) {
  const n = mapData.nodes[id];
  const clip = { text: n.text, collapsed: !!n.collapsed };
  if (n.amount !== undefined && n.amount !== null) clip.amount = n.amount;
  if (n.hueOverride !== undefined && n.hueOverride !== null) clip.hueOverride = n.hueOverride;
  if (n.note) clip.note = n.note;
  clip.children = childrenOf(id).map(cloneSubtreeForClipboard);
  return clip;
}

function copySelected() {
  if (!selectedId || !mapData.nodes[selectedId]) return;
  clipboardNode = cloneSubtreeForClipboard(selectedId);
  const count = collectDescendants(selectedId).length;
  toast(count > 0
    ? `Copied "${mapData.nodes[selectedId].text}" + ${count} sub-idea${count === 1 ? '' : 's'}`
    : `Copied "${mapData.nodes[selectedId].text}"`);
}

function pasteNodeUnder(clip, parentId) {
  const extra = { collapsed: clip.collapsed };
  if (clip.amount !== undefined) extra.amount = clip.amount;
  if (clip.hueOverride !== undefined) extra.hueOverride = clip.hueOverride;
  if (clip.note !== undefined) {
    extra.note = clip.note;
    extra.noteUpdatedBy = currentUser.uid;
    extra.noteUpdatedByName = currentUser.displayName || currentUser.email || 'Someone';
    extra.noteUpdatedAt = Date.now();
  }
  const id = createChildNode(parentId, clip.text, extra);
  clip.children.forEach(childClip => pasteNodeUnder(childClip, id));
  return id;
}

function pasteClipboard() {
  if (!clipboardNode || !selectedId || !mapData.nodes[selectedId]) return;
  const newId = pasteNodeUnder(clipboardNode, selectedId);
  relayoutChildren(selectedId);
  markMetaDirty();
  selectedId = newId;
  renderAll();
}

// ============================================================
// RENDERING
// ============================================================
const worldEl = $('#canvas-world');
const edgeLayer = $('#edge-layer');
const nodeLayer = $('#node-layer');
const canvasWrap = $('#canvas-wrap');

function applyViewTransform() {
  worldEl.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.scale})`;
  $('#zoom-level').textContent = `${Math.round(view.scale * 100)}%`;
}

function centerView() {
  const rect = canvasWrap.getBoundingClientRect();
  view.panX = rect.width / 2;
  view.panY = rect.height / 2;
  view.scale = 1;
  applyViewTransform();
}

function visibleNodeIds() {
  const hidden = new Set();
  function markHidden(id) { for (const kid of childrenOf(id)) { hidden.add(kid); markHidden(kid); } }
  Object.entries(mapData.nodes).forEach(([id, n]) => { if (n.collapsed) markHidden(id); });
  return Object.keys(mapData.nodes).filter(id => !hidden.has(id));
}

function renderAll() {
  nodeLayer.innerHTML = '';
  edgeLayer.innerHTML = '';
  const ids = visibleNodeIds();
  ids.forEach(id => {
    const n = mapData.nodes[id];
    if (!n.parentId || !ids.includes(n.parentId)) return;
    edgeLayer.appendChild(makeEdgePath(mapData.nodes[n.parentId], n, id));
  });
  ids.forEach(id => nodeLayer.appendChild(makeNodeEl(id)));
  applyViewTransform();
  renderNodeActions();
  renderNotesPanel();
}

function makeEdgePath(p, n, childId) {
  const ns = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  ns.setAttribute('d', edgeD(p, n));
  ns.setAttribute('class', 'edge-path');
  if (childId) ns.dataset.child = childId;
  const color = colorForNode(n);
  // fill:none also lives in the .edge-path CSS rule, but set it as an
  // attribute too — the PNG export's DOM-to-image step doesn't reliably
  // carry class-based styles onto cloned SVG elements, and a path's
  // default (black) fill paints the wedge between an open bezier curve
  // and its implicit closing line back to the start point.
  ns.setAttribute('fill', 'none');
  ns.setAttribute('stroke', color.bg);
  ns.setAttribute('stroke-width', Math.max(2, 6 - (n.depth - 1) * 1.1));
  ns.setAttribute('opacity', '0.85');
  return ns;
}

function makeNodeEl(id) {
  const n = mapData.nodes[id];
  const el = document.createElement('div');
  el.className = 'node' + (n.depth === 0 ? ' is-root' : '') + (id === selectedId ? ' is-selected' : '');
  el.style.left = n.x + 'px';
  el.style.top = n.y + 'px';
  const c = colorForNode(n);
  el.style.background = c.bg;
  el.style.color = c.text;
  el.style.borderColor = c.stroke;
  el.dataset.id = id;
  const attrTip = attributionTooltip(n);
  if (attrTip) el.title = attrTip;

  const label = document.createElement('div');
  label.className = 'node-label';
  label.textContent = n.text;
  if (id === editingId) label.contentEditable = 'true';
  el.appendChild(label);

  const total = computeNodeTotal(id);
  if (total !== 0) {
    const valueEl = document.createElement('div');
    valueEl.className = 'node-value';
    valueEl.textContent = formatCurrency(total);
    el.appendChild(valueEl);
  }

  const kids = childrenOf(id);
  if (kids.length > 0) {
    const toggle = document.createElement('div');
    toggle.className = 'node-toggle';
    toggle.textContent = n.collapsed ? kids.length : '−';
    toggle.title = n.collapsed ? 'Expand' : 'Collapse';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      n.collapsed = !n.collapsed;
      queueNodeWrite(id);
      renderAll();
    });
    el.appendChild(toggle);
  }

  if (n.note) {
    const badge = document.createElement('div');
    badge.className = 'node-note-badge';
    badge.textContent = '📝';
    badge.title = 'Has a note — click to view';
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedId = id;
      refreshNodeSelectionClasses();
      openNotePicker(id, el);
    });
    el.appendChild(badge);
  }

  attachNodeInteractions(el, id);
  return el;
}

// ------------------------------------------------------------
// Budgeting: an optional numeric amount per node. Every node's
// displayed total is its own amount plus the sum of every descendant's
// total, computed recursively — so a parent automatically rolls up
// whatever its children (and their children, etc.) are worth, all the
// way up to the root showing a grand total.
// ------------------------------------------------------------
const CURRENCY_SYMBOL = '$'; // change this one constant for a different currency

function computeNodeTotal(id) {
  const n = mapData.nodes[id];
  let sum = typeof n.amount === 'number' ? n.amount : 0;
  for (const kid of childrenOf(id)) sum += computeNodeTotal(kid);
  return sum;
}

function formatCurrency(num) {
  const sign = num < 0 ? '-' : '';
  return sign + CURRENCY_SYMBOL + Math.abs(num).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function refreshNodeSelectionClasses() {
  $all('.node', nodeLayer).forEach(el => el.classList.toggle('is-selected', el.dataset.id === selectedId));
  renderNodeActions();
}

// ------------------------------------------------------------
// Node interactions: select, drag, edit, keyboard
// ------------------------------------------------------------
function attachNodeInteractions(el, id) {
  const label = el.querySelector('.node-label');
  let dragging = false, moved = false, startX, startY;
  // The dragged node's whole subtree moves with it — origins and DOM
  // elements for every descendant are snapshotted once at drag start
  // rather than re-queried on every pointermove.
  let subtreeIds = [], origPositions = null, subtreeEls = null;

  el.addEventListener('pointerdown', (e) => {
    if (label.isContentEditable) return;
    // Small satellite controls (collapse toggle, note badge) handle their
    // own clicks — bail before we capture the pointer, or the browser
    // retargets their click event to this node instead of the control.
    if (e.target.closest('.node-toggle, .node-note-badge')) return;
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    dragging = true; moved = false;
    startX = e.clientX; startY = e.clientY;

    subtreeIds = [id, ...collectDescendants(id)];
    origPositions = new Map();
    subtreeEls = new Map();
    for (const nid of subtreeIds) {
      const n = mapData.nodes[nid];
      origPositions.set(nid, { x: n.x, y: n.y });
      const nodeEl = nid === id ? el : nodeLayer.querySelector(`[data-id="${nid}"]`);
      if (nodeEl) subtreeEls.set(nid, nodeEl);
      draggingSubtreeIds.add(nid);
    }
    draggingId = id;
  });

  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = (e.clientX - startX) / view.scale;
    const dy = (e.clientY - startY) / view.scale;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    if (!moved) return;
    for (const nid of subtreeIds) {
      const n = mapData.nodes[nid];
      const orig = origPositions.get(nid);
      n.x = orig.x + dx;
      n.y = orig.y + dy;
      n.manual = true;
      const nodeEl = subtreeEls.get(nid);
      if (nodeEl) {
        nodeEl.style.left = n.x + 'px';
        nodeEl.style.top = n.y + 'px';
      }
    }
    el.classList.add('is-dragging');
    updateEdgesForDrag(subtreeIds);
  });

  el.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('is-dragging');
    if (moved) { subtreeIds.forEach(queueNodeWrite); }
    else { selectNode(id); }
    subtreeIds.forEach(nid => draggingSubtreeIds.delete(nid));
    draggingId = null;
    subtreeIds = []; origPositions = null; subtreeEls = null;
  });

  label.addEventListener('dblclick', (e) => { e.stopPropagation(); startEditing(id); });
  label.addEventListener('blur', () => { if (editingId === id) commitEditing(label); });

  label.addEventListener('keydown', (e) => {
    if (editingId !== id) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEditing(label);
      const n = mapData.nodes[id];
      if (n.parentId) {
        const newId = addChildNode(n.parentId, '');
        startEditing(newId);
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitEditing(label);
      const newId = addChildNode(id, '');
      startEditing(newId);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      label.blur();
    }
  });
}

function updateEdgesForDrag(ids) {
  // Only the "own" edge (parent -> node) for each node in the dragged
  // subtree actually needs redrawing — since every descendant moved by
  // the same delta, that single edge per node covers both the entry
  // edge into the dragged node (from its stationary parent) and every
  // edge inside the subtree. Touching just those instead of tearing
  // down and rebuilding every edge in the map is what keeps dragging
  // smooth on anything but tiny maps.
  ids.forEach(id => {
    const n = mapData.nodes[id];
    if (n.parentId && mapData.nodes[n.parentId]) {
      const ownEdge = edgeLayer.querySelector(`[data-child="${id}"]`);
      if (ownEdge) ownEdge.setAttribute('d', edgeD(mapData.nodes[n.parentId], n));
    }
  });
}

function edgeD(p, n) {
  const dx = (n.x - p.x) * 0.5;
  return `M ${p.x} ${p.y} C ${p.x + dx} ${p.y}, ${n.x - dx} ${n.y}, ${n.x} ${n.y}`;
}

function selectNode(id) { selectedId = id; refreshNodeSelectionClasses(); }

function startEditing(id) {
  if (editingId && editingId !== id) {
    const prevEl = nodeLayer.querySelector(`[data-id="${editingId}"] .node-label`);
    if (prevEl) commitEditing(prevEl);
  }
  editingId = id;
  selectedId = id;
  renderAll();
  // Double-RAF: wait a full extra frame past the render so the browser
  // has definitely painted the new contentEditable node before we try
  // to focus it — a single RAF was occasionally landing before layout
  // settled, which made a fresh node silently fail to pick up focus.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const el = nodeLayer.querySelector(`[data-id="${id}"] .node-label`);
      if (el) { el.focus(); document.getSelection().selectAllChildren(el); }
    });
  });
}

function commitEditing(labelEl) {
  const id = labelEl.closest('.node').dataset.id;
  const n = mapData.nodes[id];
  const text = labelEl.textContent.trim() || 'Untitled';
  if (n.text !== text) {
    n.text = text;
    n.updatedBy = currentUser.uid;
    n.updatedByName = currentUser.displayName || currentUser.email || 'Someone';
    n.updatedAt = Date.now();
    queueNodeWrite(id);
  }
  editingId = null;
  labelEl.contentEditable = 'false';
  renderNodeActions();
}

// ------------------------------------------------------------
// Floating action bubble for selected node
// ------------------------------------------------------------
let actionsEl = null;
function renderNodeActions() {
  if (actionsEl) { actionsEl.remove(); actionsEl = null; }
  if (!selectedId || editingId || !mapData || !mapData.nodes[selectedId]) return;
  const n = mapData.nodes[selectedId];
  actionsEl = document.createElement('div');
  actionsEl.className = 'node-actions';
  actionsEl.style.left = n.x + 'px';
  actionsEl.style.top = (n.y - (n.depth === 0 ? 46 : 40)) + 'px';
  actionsEl.style.transform = 'translate(-50%, -100%)';

  const caption = attributionCaption(n);
  if (caption) {
    const cap = document.createElement('div');
    cap.className = 'node-actions-caption';
    cap.textContent = caption;
    actionsEl.appendChild(cap);
  }

  const row = document.createElement('div');
  row.className = 'node-actions-row';
  actionsEl.appendChild(row);

  const addBtn = document.createElement('button');
  addBtn.textContent = '+';
  addBtn.title = 'Add child idea (Tab)';
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const newId = addChildNode(selectedId, '');
    startEditing(newId);
  });
  row.appendChild(addBtn);

  const renameBtn = document.createElement('button');
  renameBtn.textContent = '✎';
  renameBtn.title = 'Rename';
  renameBtn.addEventListener('click', (e) => { e.stopPropagation(); startEditing(selectedId); });
  row.appendChild(renameBtn);

  const amountBtn = document.createElement('button');
  amountBtn.textContent = '💲';
  amountBtn.title = (n.amount !== undefined && n.amount !== null) ? 'Edit amount' : 'Add amount';
  amountBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const nodeEl = nodeLayer.querySelector(`[data-id="${selectedId}"]`);
    if (nodeEl) openAmountPicker(selectedId, nodeEl);
  });
  row.appendChild(amountBtn);

  const noteBtn = document.createElement('button');
  noteBtn.textContent = '📝';
  noteBtn.title = n.note ? 'Edit note' : 'Add note';
  noteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const nodeEl = nodeLayer.querySelector(`[data-id="${selectedId}"]`);
    if (nodeEl) openNotePicker(selectedId, nodeEl);
  });
  row.appendChild(noteBtn);

  const copyBtn = document.createElement('button');
  copyBtn.textContent = '⧉';
  copyBtn.title = 'Copy branch (Ctrl+C)';
  copyBtn.addEventListener('click', (e) => { e.stopPropagation(); copySelected(); });
  row.appendChild(copyBtn);

  if (clipboardNode) {
    const pasteBtn = document.createElement('button');
    pasteBtn.textContent = '📥';
    pasteBtn.title = 'Paste as child (Ctrl+V)';
    pasteBtn.addEventListener('click', (e) => { e.stopPropagation(); pasteClipboard(); });
    row.appendChild(pasteBtn);
  }

  if (n.depth > 0) {
    const delBtn = document.createElement('button');
    delBtn.textContent = '🗑';
    delBtn.title = 'Delete branch (Del)';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); handleDeleteSelected(); });
    row.appendChild(delBtn);
  }

  if (n.depth >= 1) {
    const swBtn = document.createElement('button');
    swBtn.innerHTML = '<span class="swatch" style="background:' + colorForNode(n).bg + '"></span>';
    swBtn.title = n.hueOverride !== undefined && n.hueOverride !== null
      ? 'Click to reshuffle this branch\'s color · Right-click to reset to inherited'
      : 'Click to give this branch its own color';
    swBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      n.hueOverride = Math.round(Math.random() * 360);
      queueNodeWrite(selectedId);
      renderAll();
    });
    swBtn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (n.hueOverride === undefined || n.hueOverride === null) return;
      delete n.hueOverride;
      queueNodeWrite(selectedId);
      renderAll();
    });
    row.appendChild(swBtn);
  }

  nodeLayer.appendChild(actionsEl);
}

// ------------------------------------------------------------
// Amount picker — small inline numeric input popover for setting a
// node's own budget amount, same visual pattern as the board's
// due-date picker.
// ------------------------------------------------------------
function closeAmountPicker() {
  const existing = document.getElementById('amount-picker');
  if (existing) existing.remove();
}
function openAmountPicker(nodeId, nodeEl) {
  closeAmountPicker();
  const n = mapData.nodes[nodeId];
  const pop = document.createElement('div');
  pop.className = 'amount-picker';
  pop.id = 'amount-picker';

  const input = document.createElement('input');
  input.type = 'number';
  input.step = 'any';
  input.placeholder = 'Amount';
  input.value = (n.amount !== undefined && n.amount !== null) ? n.amount : '';
  pop.appendChild(input);

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.className = 'btn btn-primary btn-tiny';
  saveBtn.addEventListener('click', (e) => { e.stopPropagation(); commitAmount(nodeId, input.value); });
  pop.appendChild(saveBtn);

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.className = 'btn btn-ghost btn-tiny';
  clearBtn.addEventListener('click', (e) => { e.stopPropagation(); commitAmount(nodeId, ''); });
  pop.appendChild(clearBtn);

  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // don't let map-editor global shortcuts (Tab/Delete/etc.) fire while typing here
    if (e.key === 'Enter') { e.preventDefault(); commitAmount(nodeId, input.value); }
    else if (e.key === 'Escape') { e.preventDefault(); closeAmountPicker(); }
  });

  document.body.appendChild(pop);
  const rect = nodeEl.getBoundingClientRect();
  pop.style.left = Math.min(rect.left, window.innerWidth - 220) + 'px';
  pop.style.top = (rect.bottom + 8) + 'px';
  input.focus();
  input.select();
}
function commitAmount(nodeId, rawValue) {
  const n = mapData.nodes[nodeId];
  const trimmed = String(rawValue).trim();
  if (trimmed === '') {
    delete n.amount;
  } else {
    const num = parseFloat(trimmed);
    if (!isNaN(num)) n.amount = num;
  }
  queueNodeWrite(nodeId);
  closeAmountPicker();
  renderAll();
}
document.addEventListener('click', (e) => {
  const pop = document.getElementById('amount-picker');
  if (pop && !pop.contains(e.target) && !e.target.closest('.node-actions')) closeAmountPicker();
});

// ------------------------------------------------------------
// Note picker — a free-text comment any collaborator can add, edit,
// or delete on any node, same visual pattern as the amount picker.
// Synced as an ordinary node field, so it's shared and live like
// everything else on the map — no separate permission model.
// ------------------------------------------------------------
function closeNotePicker() {
  const existing = document.getElementById('note-picker');
  if (existing) existing.remove();
}
function openNotePicker(nodeId, nodeEl) {
  closeNotePicker();
  closeAmountPicker();
  const n = mapData.nodes[nodeId];
  const pop = document.createElement('div');
  pop.className = 'note-picker';
  pop.id = 'note-picker';

  if (n.noteUpdatedBy && n.noteUpdatedAt) {
    const caption = document.createElement('div');
    caption.className = 'note-picker-caption';
    caption.textContent = `Note by ${n.noteUpdatedByName || 'someone'} · ${relativeTime(new Date(n.noteUpdatedAt))}`;
    pop.appendChild(caption);
  }

  const textarea = document.createElement('textarea');
  textarea.placeholder = 'Add a note…';
  textarea.value = n.note || '';
  pop.appendChild(textarea);

  const actions = document.createElement('div');
  actions.className = 'note-picker-actions';
  pop.appendChild(actions);

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Delete';
  clearBtn.className = 'btn btn-ghost btn-tiny';
  clearBtn.addEventListener('click', (e) => { e.stopPropagation(); commitNote(nodeId, ''); });
  actions.appendChild(clearBtn);

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.className = 'btn btn-primary btn-tiny';
  saveBtn.addEventListener('click', (e) => { e.stopPropagation(); commitNote(nodeId, textarea.value); });
  actions.appendChild(saveBtn);

  textarea.addEventListener('keydown', (e) => {
    e.stopPropagation(); // don't let map-editor global shortcuts (Tab/Delete/etc.) fire while typing here
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitNote(nodeId, textarea.value); }
    else if (e.key === 'Escape') { e.preventDefault(); closeNotePicker(); }
  });

  document.body.appendChild(pop);
  const rect = nodeEl.getBoundingClientRect();
  pop.style.left = Math.min(rect.left, window.innerWidth - 260) + 'px';
  pop.style.top = (rect.bottom + 8) + 'px';
  textarea.focus();
}
function commitNote(nodeId, rawValue) {
  const n = mapData.nodes[nodeId];
  const trimmed = String(rawValue).trim();
  const changed = trimmed !== (n.note || '');
  if (trimmed === '') {
    delete n.note;
    delete n.noteUpdatedBy;
    delete n.noteUpdatedByName;
    delete n.noteUpdatedAt;
  } else if (changed) {
    n.note = trimmed;
    n.noteUpdatedBy = currentUser.uid;
    n.noteUpdatedByName = currentUser.displayName || currentUser.email || 'Someone';
    n.noteUpdatedAt = Date.now();
  }
  queueNodeWrite(nodeId);
  closeNotePicker();
  renderAll();
}
document.addEventListener('click', (e) => {
  const pop = document.getElementById('note-picker');
  if (pop && !pop.contains(e.target) && !e.target.closest('.node-actions') && !e.target.closest('.node-note-badge')) closeNotePicker();
});

// ------------------------------------------------------------
// Notes panel — a live index of every note on the map, so a
// collaborator doesn't have to hunt the canvas for the 📝 badges.
// Clicking an entry pans/selects that node, expanding any collapsed
// ancestor that's currently hiding it.
// ------------------------------------------------------------
function collectNotes() {
  return Object.entries(mapData.nodes)
    .filter(([, n]) => n.note)
    .map(([id, n]) => ({ id, n }))
    .sort((a, b) => (b.n.noteUpdatedAt || 0) - (a.n.noteUpdatedAt || 0));
}

function renderNotesPanel() {
  const notes = collectNotes();
  const btn = $('#btn-notes');
  if (btn) btn.textContent = notes.length ? `📝 Notes (${notes.length})` : '📝 Notes';

  const panel = $('#notes-panel');
  if (panel.hidden) return;
  const list = $('#notes-list');
  if (notes.length === 0) {
    list.innerHTML = '<p class="share-owner-note">No notes yet — click the 📝 on any node to add one.</p>';
    return;
  }
  list.innerHTML = '';
  notes.forEach(({ id, n }) => {
    const item = document.createElement('div');
    item.className = 'notes-panel-item';
    const nodeName = document.createElement('div');
    nodeName.className = 'notes-panel-item-node';
    nodeName.textContent = n.text;
    const noteText = document.createElement('div');
    noteText.className = 'notes-panel-item-note';
    noteText.textContent = n.note;
    const meta = document.createElement('div');
    meta.className = 'notes-panel-item-meta';
    meta.textContent = `${n.noteUpdatedByName || 'Someone'} · ${n.noteUpdatedAt ? relativeTime(new Date(n.noteUpdatedAt)) : 'just now'}`;
    item.append(nodeName, noteText, meta);
    item.addEventListener('click', () => {
      $('#notes-panel').hidden = true;
      focusNode(id);
    });
    list.appendChild(item);
  });
}

function openNotesPanel() {
  const panel = $('#notes-panel');
  if (!panel.hidden) { panel.hidden = true; return; }
  $('#share-panel').hidden = true;
  panel.hidden = false;
  renderNotesPanel();
}
$('#btn-notes').addEventListener('click', (e) => { e.stopPropagation(); openNotesPanel(); });
document.addEventListener('click', (e) => {
  const panel = $('#notes-panel');
  if (!panel.hidden && !panel.contains(e.target) && !e.target.closest('#btn-notes')) panel.hidden = true;
});

// Pans the canvas to center the given node, expanding any collapsed
// ancestor that's hiding it, and briefly pulses it so it's easy to spot.
function focusNode(id) {
  const n = mapData.nodes[id];
  if (!n) return;
  let expanded = false;
  let pid = n.parentId;
  while (pid) {
    const p = mapData.nodes[pid];
    if (p.collapsed) { p.collapsed = false; queueNodeWrite(pid); expanded = true; }
    pid = p.parentId;
  }
  if (expanded) renderAll();

  selectedId = id;
  refreshNodeSelectionClasses();

  const rect = canvasWrap.getBoundingClientRect();
  view.scale = Math.max(view.scale, 1);
  view.panX = rect.width / 2 - n.x * view.scale;
  view.panY = rect.height / 2 - n.y * view.scale;
  applyViewTransform();

  const el = nodeLayer.querySelector(`[data-id="${id}"]`);
  if (el) {
    el.classList.remove('is-pulse');
    void el.offsetWidth; // restart the animation if it's already mid-pulse
    el.classList.add('is-pulse');
    setTimeout(() => el.classList.remove('is-pulse'), 1700);
  }
}

function handleDeleteSelected() {
  if (!selectedId || selectedId === mapData.rootId) return;
  const n = mapData.nodes[selectedId];
  const kidCount = collectDescendants(selectedId).length;
  if (kidCount > 0 && !confirm(`Delete "${n.text}" and its ${kidCount} sub-idea${kidCount === 1 ? '' : 's'}?`)) return;
  const parentId = n.parentId;
  deleteNodeSubtree(selectedId);
  selectedId = parentId;
  renderAll();
}

// ------------------------------------------------------------
// Canvas panning + zoom
// ------------------------------------------------------------
let panning = false, panStartX, panStartY, panOrigX, panOrigY;

// Zoom the view so that the given point (in canvasWrap-local pixels)
// stays under the cursor/fingers as the scale changes.
function zoomAroundPoint(mx, my, newScale) {
  newScale = Math.min(2.2, Math.max(0.25, newScale));
  const worldX = (mx - view.panX) / view.scale;
  const worldY = (my - view.panY) / view.scale;
  view.panX = mx - worldX * newScale;
  view.panY = my - worldY * newScale;
  view.scale = newScale;
  applyViewTransform();
}

// Pointers currently down on the canvas background (not on a node),
// keyed by pointerId, used for both single-finger panning and
// two-finger pinch-to-zoom on touch devices.
const canvasPointers = new Map();
let pinchStartDist = null, pinchStartScale = null;

function pinchMidpoint() {
  const pts = [...canvasPointers.values()];
  const rect = canvasWrap.getBoundingClientRect();
  return {
    x: (pts[0].x + pts[1].x) / 2 - rect.left,
    y: (pts[0].y + pts[1].y) / 2 - rect.top,
  };
}
function pinchDist() {
  const pts = [...canvasPointers.values()];
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
}

canvasWrap.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.node') || e.target.closest('.node-actions')) return;
  canvasPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (canvasPointers.size === 2) {
    panning = false;
    canvasWrap.classList.remove('is-panning');
    pinchStartDist = pinchDist();
    pinchStartScale = view.scale;
  } else if (canvasPointers.size === 1) {
    panning = true;
    canvasWrap.classList.add('is-panning');
    panStartX = e.clientX; panStartY = e.clientY;
    panOrigX = view.panX; panOrigY = view.panY;
    selectedId = null;
    renderNodeActions();
    refreshNodeSelectionClasses();
  }
});
window.addEventListener('pointermove', (e) => {
  if (!canvasPointers.has(e.pointerId)) return;
  canvasPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (canvasPointers.size === 2 && pinchStartDist) {
    const { x, y } = pinchMidpoint();
    const newScale = pinchStartScale * (pinchDist() / pinchStartDist);
    zoomAroundPoint(x, y, newScale);
  } else if (canvasPointers.size === 1 && panning) {
    view.panX = panOrigX + (e.clientX - panStartX);
    view.panY = panOrigY + (e.clientY - panStartY);
    applyViewTransform();
  }
});
function releaseCanvasPointer(e) {
  canvasPointers.delete(e.pointerId);
  pinchStartDist = null;
  panning = false;
  canvasWrap.classList.remove('is-panning');
  // If one finger remains after a pinch, resume panning from it
  // instead of jumping back to a stale single-pointer start.
  if (canvasPointers.size === 1) {
    const pt = [...canvasPointers.values()][0];
    panning = true;
    canvasWrap.classList.add('is-panning');
    panStartX = pt.x; panStartY = pt.y;
    panOrigX = view.panX; panOrigY = view.panY;
  }
}
window.addEventListener('pointerup', releaseCanvasPointer);
window.addEventListener('pointercancel', releaseCanvasPointer);

canvasWrap.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = canvasWrap.getBoundingClientRect();
  const delta = -e.deltaY * 0.0015;
  zoomAroundPoint(e.clientX - rect.left, e.clientY - rect.top, view.scale * (1 + delta));
}, { passive: false });

$('#btn-zoom-in').addEventListener('click', () => zoomBy(1.2));
$('#btn-zoom-out').addEventListener('click', () => zoomBy(1 / 1.2));
$('#btn-zoom-reset').addEventListener('click', centerView);
function zoomBy(factor) {
  const rect = canvasWrap.getBoundingClientRect();
  zoomAroundPoint(rect.width / 2, rect.height / 2, view.scale * factor);
}

// ------------------------------------------------------------
// Global keyboard shortcuts (when not editing text)
// ------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  if ($('#view-editor').hidden) return;
  if (editingId) return;
  if (document.activeElement === $('#map-title-input')) return;

  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
    e.preventDefault();
    handleDeleteSelected();
  } else if (e.key === 'Tab' && selectedId) {
    e.preventDefault();
    const newId = addChildNode(selectedId, '');
    startEditing(newId);
  } else if (e.key === 'Enter' && selectedId) {
    e.preventDefault();
    startEditing(selectedId);
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selectedId) {
    e.preventDefault();
    copySelected();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && selectedId && clipboardNode) {
    e.preventDefault();
    pasteClipboard();
  }
});

// ============================================================
// Title editing
// ============================================================
$('#map-title-input').addEventListener('change', () => {
  mapData.title = $('#map-title-input').value.trim() || 'Untitled map';
  markMetaDirty();
});

// ============================================================
// Share panel (owner: invite code + collaborator list) — shared
// between the map editor and board editor via activeKind/activeId.
// ============================================================
function openSharePanel() {
  if (!isOwner()) { toast(`Only the ${activeKind === 'board' ? 'board' : 'map'} owner can manage sharing.`); return; }
  const panel = $('#share-panel');
  if (!panel.hidden) { panel.hidden = true; return; }
  $('#notes-panel').hidden = true;
  (async () => {
    if (!activeData().shareCode) await regenerateShareCode(/*silent=*/true);
    renderSharePanel();
    panel.hidden = false;
  })();
}
$('#btn-share').addEventListener('click', (e) => { e.stopPropagation(); openSharePanel(); });
$('#btn-board-share').addEventListener('click', (e) => { e.stopPropagation(); openSharePanel(); });

document.addEventListener('click', (e) => {
  const panel = $('#share-panel');
  if (!panel.hidden && !panel.contains(e.target) && e.target.id !== 'btn-share' && e.target.id !== 'btn-board-share') panel.hidden = true;
});

function renderSharePanel() {
  $('#share-code-value').textContent = activeData().shareCode || '------';
  renderShareCollabList();
}

function renderShareCollabList() {
  const list = $('#share-collab-list');
  const data = activeData();
  const collabs = data.collaborators || [];
  if (collabs.length === 0) {
    list.innerHTML = '<p class="share-owner-note">No collaborators yet — send them the code above.</p>';
    return;
  }
  list.innerHTML = '';
  collabs.forEach(uidVal => {
    const row = document.createElement('div');
    row.className = 'share-collab-item';
    row.innerHTML = `<span>${escapeHtml(uidVal.slice(0, 10))}…</span>`;
    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', async () => {
      data.collaborators = data.collaborators.filter(u => u !== uidVal);
      await updateDoc(doc(db, activeCollectionName(), activeId), { collaborators: arrayRemove(uidVal) });
      renderShareCollabList();
    });
    row.appendChild(removeBtn);
    list.appendChild(row);
  });
}

async function regenerateShareCode(silent) {
  const data = activeData();
  const oldCode = data.shareCode;
  const newCode = makeShareCode();
  data.shareCode = newCode;
  const codeCollection = activeJoinCodeCollectionName();
  const idField = activeKind === 'board' ? 'boardId' : 'mapId';
  await setDoc(doc(db, codeCollection, newCode), { [idField]: activeId, ownerId: currentUser.uid });
  await updateDoc(doc(db, activeCollectionName(), activeId), { shareCode: newCode });
  if (oldCode) { try { await deleteDoc(doc(db, codeCollection, oldCode)); } catch (_) { /* ignore */ } }
  if (!silent) toast('New invite code generated');
}

$('#share-regen').addEventListener('click', async (e) => {
  e.stopPropagation();
  await regenerateShareCode(false);
  renderSharePanel();
});

$('#share-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(activeData().shareCode || '');
    toast('Code copied');
  } catch (_) {
    toast(activeData().shareCode || '');
  }
});

$('#share-copy-message').addEventListener('click', async () => {
  const data = activeData();
  const code = data.shareCode || '';
  const link = `${location.origin}${location.pathname}?code=${code}`;
  const itemWord = activeKind === 'board' ? 'board' : 'mind map';
  const title = data.title || `Untitled ${itemWord}`;
  const message = `Join my ${itemWord} "${title}" on Branchwork: ${link}\nInvite code: ${code}`;
  try {
    await navigator.clipboard.writeText(message);
    toast('Invite message copied');
  } catch (_) {
    toast(message);
  }
});

// ============================================================
// Autosave — granular field writes so concurrent collaborators
// never stomp each other with a full-document overwrite.
// ============================================================
function queueNodeWrite(id) {
  pendingWrites[`nodes.${id}`] = JSON.parse(JSON.stringify(mapData.nodes[id]));
  markSaving();
}
function queueNodeDelete(id) {
  pendingWrites[`nodes.${id}`] = deleteField();
  markSaving();
}
function markMetaDirty() {
  pendingWrites['title'] = mapData.title;
  markSaving();
}
function markSaving() {
  $('#save-status').textContent = 'Unsaved changes…';
}

let autosaveInterval = null;
function startAutosaveLoop() {
  stopAutosaveLoop();
  autosaveInterval = setInterval(saveIfDirty, 1200);
}
function stopAutosaveLoop() {
  if (autosaveInterval) clearInterval(autosaveInterval);
  autosaveInterval = null;
}

async function saveIfDirty() {
  const keys = Object.keys(pendingWrites);
  if (keys.length === 0 || !mapId) return;
  const toSend = { ...pendingWrites, updatedAt: serverTimestamp() };
  pendingWrites = {};
  $('#save-status').textContent = 'Saving…';
  try {
    await updateDoc(doc(db, 'maps', mapId), toSend);
    $('#save-status').textContent = 'Saved';
  } catch (err) {
    delete toSend.updatedAt;
    pendingWrites = { ...toSend, ...pendingWrites };
    $('#save-status').textContent = 'Save failed — retrying…';
  }
}

window.addEventListener('beforeunload', () => {
  if (Object.keys(pendingWrites).length) saveIfDirty();
  if (Object.keys(boardPendingWrites).length) saveBoardIfDirty();
});

// ============================================================
// Export
// ============================================================
function exportActiveItem() {
  const data = activeData();
  if (!data) return;
  const itemWord = activeKind === 'board' ? 'board' : 'map';
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(data.title || itemWord).replace(/[^a-z0-9-_]+/gi, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`${activeKind === 'board' ? 'Board' : 'Map'} exported as JSON`);
}
$('#btn-export').addEventListener('click', exportActiveItem);
$('#btn-board-export').addEventListener('click', exportActiveItem);

// ------------------------------------------------------------
// PNG export — rasterizes every currently-expanded node (collapsed
// branches are excluded, same set renderAll() draws) into a single
// image, regardless of what's currently scrolled/zoomed into view.
// Renders worldEl itself rather than the visible canvas-wrap, so the
// captured area isn't limited by the viewport or clipped by its
// overflow:hidden — only the pan/zoom transform needs to be swapped
// out for one that fits the full node bounding box, which html-to-image
// does on a clone, leaving the live view untouched.
// ------------------------------------------------------------
function visibleNodeBoundingBox() {
  const ids = visibleNodeIds();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  ids.forEach(id => {
    const n = mapData.nodes[id];
    const el = nodeLayer.querySelector(`[data-id="${id}"]`);
    const w = el ? el.offsetWidth : 120;
    const h = el ? el.offsetHeight : 44;
    minX = Math.min(minX, n.x - w / 2);
    maxX = Math.max(maxX, n.x + w / 2);
    minY = Math.min(minY, n.y - h / 2);
    maxY = Math.max(maxY, n.y + h / 2);
  });
  if (minX === Infinity) return { minX: -100, minY: -40, maxX: 100, maxY: 40 };
  return { minX, minY, maxX, maxY };
}

async function exportMapAsPng() {
  if (!mapData) return;
  const btn = $('#btn-export-png');
  const original = btn.textContent;
  btn.textContent = 'Rendering…';
  btn.disabled = true;
  try {
    const PAD = 48;
    const { minX, minY, maxX, maxY } = visibleNodeBoundingBox();
    const width = Math.ceil(maxX - minX + PAD * 2);
    const height = Math.ceil(maxY - minY + PAD * 2);
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() || '#ffffff';
    const blob = await htmlToImage.toBlob(worldEl, {
      width, height,
      pixelRatio: 2,
      backgroundColor: bg,
      filter: (node) => !(node.classList && node.classList.contains('node-actions')),
      style: {
        transform: `translate(${-minX + PAD}px, ${-minY + PAD}px) scale(1)`,
        transformOrigin: '0 0'
      }
    });
    if (!blob) throw new Error('Nothing to render');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(mapData.title || 'mind-map').replace(/[^a-z0-9-_]+/gi, '_')}.png`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Map exported as PNG');
  } catch (err) {
    toast("Couldn't export PNG — try again");
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
}
$('#btn-export-png').addEventListener('click', exportMapAsPng);

// ============================================================
// BOARD EDITOR (Kanban)
// Columns + cards, drag to reorder/move, optional due dates,
// preset label colors, real-time sync — same overall pattern as
// the map editor (granular writes, stable-diff merge, never
// rebuilding mid-edit/mid-drag), kept as its own parallel set of
// functions rather than unified with the map editor's, since the
// two data shapes are different enough that sharing state would
// add more risk than it'd save code.
// ============================================================
const CARD_PALETTE = [
  { key: 'red', hue: 0 }, { key: 'orange', hue: 28 }, { key: 'yellow', hue: 48 },
  { key: 'green', hue: 145 }, { key: 'blue', hue: 205 }, { key: 'purple', hue: 265 }, { key: 'pink', hue: 325 }
];

const boardColumnsEl = $('#board-columns');

async function openBoard(id) {
  boardId = id;
  activeKind = 'board';
  activeId = id;
  const snap = await getDoc(doc(db, 'boards', id));
  if (!snap.exists()) { toast('That board no longer exists.'); showView('dashboard'); loadDashboard(); return; }
  boardData = snap.data();
  if (!boardData.columns) boardData.columns = {};
  if (!boardData.cards) boardData.cards = {};
  if (!boardData.collaborators) boardData.collaborators = [];
  boardEditingId = null;
  boardDraggingCardId = null;
  boardPendingWrites = {};

  $('#board-title-input').value = boardData.title || 'Untitled board';
  $('#share-panel').hidden = true;
  $('#notes-panel').hidden = true;
  updateShareButtonVisibility();
  showView('board');
  renderBoard();
  startBoardAutosaveLoop();
  startBoardListener();
}

function boardColumnsSorted() {
  return Object.entries(boardData.columns)
    .sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0))
    .map(([id]) => id);
}
function boardCardsInColumn(colId) {
  return Object.entries(boardData.cards)
    .filter(([, c]) => c.columnId === colId)
    .sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0))
    .map(([id]) => id);
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function formatDueDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ------------------------------------------------------------
// Rendering
// ------------------------------------------------------------
function renderBoard() {
  boardColumnsEl.innerHTML = '';
  boardColumnsSorted().forEach((colId, i, arr) => boardColumnsEl.appendChild(makeColumnEl(colId, i, arr.length)));
  const addColBtn = document.createElement('button');
  addColBtn.className = 'board-add-column';
  addColBtn.textContent = '+ Add column';
  addColBtn.addEventListener('click', addColumn);
  boardColumnsEl.appendChild(addColBtn);
}

function makeColumnEl(colId, index, total) {
  const col = boardData.columns[colId];
  const el = document.createElement('div');
  el.className = 'board-column';
  el.dataset.colId = colId;

  const header = document.createElement('div');
  header.className = 'board-column-header';

  const titleInput = document.createElement('input');
  titleInput.className = 'board-column-title';
  titleInput.value = col.title;
  titleInput.spellcheck = false;
  titleInput.addEventListener('change', () => {
    col.title = titleInput.value.trim() || 'Untitled column';
    titleInput.value = col.title;
    queueColumnWrite(colId);
  });
  header.appendChild(titleInput);

  const countEl = document.createElement('span');
  countEl.className = 'board-column-count';
  countEl.textContent = boardCardsInColumn(colId).length;
  header.appendChild(countEl);

  if (index > 0) {
    const leftBtn = document.createElement('button');
    leftBtn.className = 'board-column-move';
    leftBtn.textContent = '←';
    leftBtn.title = 'Move column left';
    leftBtn.addEventListener('click', () => moveColumn(colId, -1));
    header.appendChild(leftBtn);
  }
  if (index < total - 1) {
    const rightBtn = document.createElement('button');
    rightBtn.className = 'board-column-move';
    rightBtn.textContent = '→';
    rightBtn.title = 'Move column right';
    rightBtn.addEventListener('click', () => moveColumn(colId, 1));
    header.appendChild(rightBtn);
  }

  const delBtn = document.createElement('button');
  delBtn.className = 'board-column-del';
  delBtn.textContent = '✕';
  delBtn.title = 'Delete column';
  delBtn.addEventListener('click', () => deleteColumn(colId));
  header.appendChild(delBtn);

  el.appendChild(header);

  const cardsEl = document.createElement('div');
  cardsEl.className = 'board-column-cards';
  cardsEl.dataset.colId = colId;
  boardCardsInColumn(colId).forEach(cardId => cardsEl.appendChild(makeCardEl(cardId)));
  el.appendChild(cardsEl);

  const addCardBtn = document.createElement('button');
  addCardBtn.className = 'board-add-card';
  addCardBtn.textContent = '+ Add card';
  addCardBtn.addEventListener('click', () => addCard(colId));
  el.appendChild(addCardBtn);

  return el;
}

function makeCardEl(cardId) {
  const c = boardData.cards[cardId];
  const el = document.createElement('div');
  el.className = 'board-card';
  el.dataset.cardId = cardId;
  if (c.color) {
    const p = CARD_PALETTE.find(p => p.key === c.color);
    if (p) el.style.borderLeftColor = `hsl(${p.hue} 70% 55%)`;
  }

  const text = document.createElement('div');
  text.className = 'board-card-text';
  text.textContent = c.text;
  if (cardId === boardEditingId) text.contentEditable = 'true';
  text.addEventListener('dblclick', (e) => { e.stopPropagation(); startCardEditing(cardId); });
  text.addEventListener('blur', () => { if (boardEditingId === cardId) commitCardEditing(text); });
  text.addEventListener('keydown', (e) => {
    if (boardEditingId !== cardId) return;
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); text.blur(); }
  });
  el.appendChild(text);

  const meta = document.createElement('div');
  meta.className = 'board-card-meta';

  if (c.dueDate) {
    const due = document.createElement('span');
    due.className = 'board-card-due' + (c.dueDate < todayStr() ? ' is-overdue' : '');
    due.textContent = formatDueDate(c.dueDate);
    meta.appendChild(due);
  } else {
    meta.appendChild(document.createElement('span')); // keeps actions right-aligned via flex
  }

  const actions = document.createElement('div');
  actions.className = 'board-card-actions';

  const dueBtn = document.createElement('button');
  dueBtn.textContent = '📅';
  dueBtn.title = 'Set due date';
  dueBtn.addEventListener('click', (e) => { e.stopPropagation(); openDuePicker(cardId, el); });
  actions.appendChild(dueBtn);

  const colorBtn = document.createElement('button');
  colorBtn.textContent = '🎨';
  colorBtn.title = 'Cycle label color';
  colorBtn.addEventListener('click', (e) => { e.stopPropagation(); cycleCardColor(cardId); });
  actions.appendChild(colorBtn);

  const delBtn = document.createElement('button');
  delBtn.textContent = '🗑';
  delBtn.title = 'Delete card';
  delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteCard(cardId); });
  actions.appendChild(delBtn);

  meta.appendChild(actions);
  el.appendChild(meta);

  const tip = attributionTooltip(c);
  if (tip) el.title = tip;

  attachCardDrag(el, cardId);
  return el;
}

// ------------------------------------------------------------
// Due-date popover — a small inline native date input anchored
// to whichever card's calendar icon was clicked.
// ------------------------------------------------------------
function closeDuePicker() {
  const existing = document.getElementById('due-picker');
  if (existing) existing.remove();
}
function openDuePicker(cardId, cardEl) {
  closeDuePicker();
  const c = boardData.cards[cardId];
  const pop = document.createElement('div');
  pop.className = 'due-picker';
  pop.id = 'due-picker';

  const input = document.createElement('input');
  input.type = 'date';
  input.value = c.dueDate || '';
  input.addEventListener('change', () => {
    c.dueDate = input.value || null;
    queueCardWrite(cardId);
    closeDuePicker();
    renderBoard();
  });
  pop.appendChild(input);

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.className = 'btn btn-ghost btn-tiny';
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    c.dueDate = null;
    queueCardWrite(cardId);
    closeDuePicker();
    renderBoard();
  });
  pop.appendChild(clearBtn);

  document.body.appendChild(pop);
  const rect = cardEl.getBoundingClientRect();
  pop.style.left = Math.min(rect.left, window.innerWidth - 240) + 'px';
  pop.style.top = (rect.bottom + 6) + 'px';
  input.focus();
}
document.addEventListener('click', (e) => {
  const pop = document.getElementById('due-picker');
  if (pop && !pop.contains(e.target) && !e.target.closest('.board-card-actions')) closeDuePicker();
});

function cycleCardColor(cardId) {
  const c = boardData.cards[cardId];
  const keys = [null, ...CARD_PALETTE.map(p => p.key)];
  const idx = keys.indexOf(c.color || null);
  c.color = keys[(idx + 1) % keys.length];
  queueCardWrite(cardId);
  renderBoard();
}

// ------------------------------------------------------------
// Card CRUD + drag
// ------------------------------------------------------------
function addCard(colId) {
  const id = uid4();
  const order = boardCardsInColumn(colId).length;
  boardData.cards[id] = {
    text: '', columnId: colId, order, color: null, dueDate: null,
    createdBy: currentUser.uid, createdByName: currentUser.displayName || currentUser.email || 'Someone', createdAt: Date.now()
  };
  queueCardWrite(id);
  renderBoard();
  startCardEditing(id);
}

function deleteCard(cardId) {
  const c = boardData.cards[cardId];
  if (!confirm(`Delete "${c.text || 'this card'}"?`)) return;
  delete boardData.cards[cardId];
  queueCardDelete(cardId);
  renderBoard();
}

function startCardEditing(cardId) {
  boardEditingId = cardId;
  renderBoard();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const el = boardColumnsEl.querySelector(`.board-card[data-card-id="${cardId}"] .board-card-text`);
      if (el) { el.focus(); document.getSelection().selectAllChildren(el); }
    });
  });
}

function commitCardEditing(textEl) {
  const cardId = textEl.closest('.board-card').dataset.cardId;
  const c = boardData.cards[cardId];
  const text = textEl.textContent.trim();
  if (!text) {
    if (!c.text) {
      // a freshly created card the user left blank — discard rather than
      // leaving an empty card sitting on the board
      delete boardData.cards[cardId];
      queueCardDelete(cardId);
    }
    boardEditingId = null;
    renderBoard();
    return;
  }
  if (c.text !== text) {
    c.text = text;
    c.updatedBy = currentUser.uid;
    c.updatedByName = currentUser.displayName || currentUser.email || 'Someone';
    c.updatedAt = Date.now();
    queueCardWrite(cardId);
  }
  boardEditingId = null;
  textEl.contentEditable = 'false';
  renderBoard();
}

function attachCardDrag(el, cardId) {
  el.addEventListener('pointerdown', (e) => {
    if (el.querySelector('.board-card-text').isContentEditable) return;
    if (e.target.closest('.board-card-actions')) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX, startY = e.clientY;
    let moved = false;

    // Deliberately NOT using setPointerCapture here: this drag works by
    // reparenting `el` into whatever column list is under the cursor as
    // you move (that's what makes the live reordering feel responsive).
    // Several browsers silently drop pointer capture the moment the
    // captured element gets reparented, which would kill the drag after
    // its very first move — so we track pointermove/pointerup on the
    // document instead, which has no such issue.
    function onMove(ev) {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
      if (!moved) {
        moved = true;
        boardDraggingCardId = cardId;
        el.classList.add('is-dragging');
      }
      el.style.pointerEvents = 'none';
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      el.style.pointerEvents = '';
      const colList = under && under.closest('.board-column-cards');
      if (colList) {
        const siblings = Array.from(colList.querySelectorAll('.board-card')).filter(c => c !== el);
        let placed = false;
        for (const sib of siblings) {
          const r = sib.getBoundingClientRect();
          if (ev.clientY < r.top + r.height / 2) { colList.insertBefore(el, sib); placed = true; break; }
        }
        if (!placed) colList.appendChild(el);
      }
    }

    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (moved) {
        el.classList.remove('is-dragging');
        boardDraggingCardId = null;
        commitCardDragResult();
      }
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}

function commitCardDragResult() {
  // The drag handler already moved the live DOM elements around as
  // feedback while dragging — read that final arrangement back into
  // boardData rather than recomputing positions separately.
  $all('.board-column-cards').forEach(colList => {
    const colId = colList.dataset.colId;
    Array.from(colList.querySelectorAll('.board-card')).forEach((cardEl, i) => {
      const cid = cardEl.dataset.cardId;
      const c = boardData.cards[cid];
      if (!c) return;
      if (c.columnId !== colId || c.order !== i) {
        c.columnId = colId;
        c.order = i;
        queueCardWrite(cid);
      }
    });
  });
  renderBoard();
}

// ------------------------------------------------------------
// Column CRUD
// ------------------------------------------------------------
function addColumn() {
  const id = uid4();
  boardData.columns[id] = { title: 'New column', order: boardColumnsSorted().length };
  queueColumnWrite(id);
  renderBoard();
}

function deleteColumn(colId) {
  const cardIds = boardCardsInColumn(colId);
  const msg = cardIds.length > 0
    ? `Delete this column and its ${cardIds.length} card${cardIds.length === 1 ? '' : 's'}?`
    : 'Delete this column?';
  if (!confirm(msg)) return;
  cardIds.forEach(cid => { delete boardData.cards[cid]; queueCardDelete(cid); });
  delete boardData.columns[colId];
  queueColumnDelete(colId);
  renderBoard();
}

function moveColumn(colId, dir) {
  const order = boardColumnsSorted();
  const idx = order.indexOf(colId);
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= order.length) return;
  const otherId = order[swapIdx];
  const a = boardData.columns[colId], b = boardData.columns[otherId];
  const tmp = a.order; a.order = b.order; b.order = tmp;
  queueColumnWrite(colId);
  queueColumnWrite(otherId);
  renderBoard();
}

// ------------------------------------------------------------
// Board title editing
// ------------------------------------------------------------
$('#board-title-input').addEventListener('change', () => {
  boardData.title = $('#board-title-input').value.trim() || 'Untitled board';
  markBoardMetaDirty();
});

// ------------------------------------------------------------
// Real-time sync — same pattern as the map editor: stable
// field-by-field diffing, and never rebuild the DOM while a card
// is being typed into or dragged.
// ------------------------------------------------------------
function startBoardListener() {
  stopBoardListener();
  unsubscribeBoard = onSnapshot(doc(db, 'boards', boardId), (snap) => {
    if (!snap.exists()) {
      toast('This board was deleted by its owner.');
      stopBoardAutosaveLoop(); stopBoardListener();
      showView('dashboard'); loadDashboard();
      return;
    }
    if (snap.metadata.hasPendingWrites) return;
    mergeRemoteIntoLocalBoard(snap.data());
  });
}
function stopBoardListener() {
  if (unsubscribeBoard) unsubscribeBoard();
  unsubscribeBoard = null;
}

function mergeRemoteIntoLocalBoard(remote) {
  if (!boardData) return;
  let needsRender = false;

  if (boardPendingWrites['title'] === undefined && remote.title !== boardData.title) {
    boardData.title = remote.title;
    if (document.activeElement !== $('#board-title-input')) $('#board-title-input').value = remote.title;
  }
  if (remote.collaborators) {
    boardData.collaborators = remote.collaborators;
    if (!$('#share-panel').hidden) renderShareCollabList();
  }
  if (remote.shareCode !== undefined && boardPendingWrites['shareCode'] === undefined) {
    boardData.shareCode = remote.shareCode;
    if (!$('#share-panel').hidden) renderSharePanel();
  }

  const remoteCols = remote.columns || {};
  const localColIds = new Set(Object.keys(boardData.columns));
  const remoteColIds = new Set(Object.keys(remoteCols));
  for (const id of remoteColIds) {
    if (boardPendingWrites[`columns.${id}`] !== undefined) continue;
    const incoming = remoteCols[id];
    const local = boardData.columns[id];
    if (!local || !nodesEqual(local, incoming)) { boardData.columns[id] = incoming; needsRender = true; }
  }
  for (const id of localColIds) {
    if (!remoteColIds.has(id) && boardPendingWrites[`columns.${id}`] === undefined) { delete boardData.columns[id]; needsRender = true; }
  }

  const remoteCards = remote.cards || {};
  const localCardIds = new Set(Object.keys(boardData.cards));
  const remoteCardIds = new Set(Object.keys(remoteCards));
  for (const id of remoteCardIds) {
    if (boardPendingWrites[`cards.${id}`] !== undefined) continue;
    if (id === boardEditingId || id === boardDraggingCardId) continue;
    const incoming = remoteCards[id];
    const local = boardData.cards[id];
    if (!local || !nodesEqual(local, incoming)) { boardData.cards[id] = incoming; needsRender = true; }
  }
  for (const id of localCardIds) {
    if (!remoteCardIds.has(id) && boardPendingWrites[`cards.${id}`] === undefined) { delete boardData.cards[id]; needsRender = true; }
  }

  if (needsRender && boardEditingId === null && boardDraggingCardId === null) renderBoard();
}

// ------------------------------------------------------------
// Autosave — granular field writes, same reasoning as the map
// editor's: never overwrite the whole document, only whatever
// specific column/card actually changed.
// ------------------------------------------------------------
function queueColumnWrite(id) {
  boardPendingWrites[`columns.${id}`] = JSON.parse(JSON.stringify(boardData.columns[id]));
  markBoardSaving();
}
function queueColumnDelete(id) {
  boardPendingWrites[`columns.${id}`] = deleteField();
  markBoardSaving();
}
function queueCardWrite(id) {
  boardPendingWrites[`cards.${id}`] = JSON.parse(JSON.stringify(boardData.cards[id]));
  markBoardSaving();
}
function queueCardDelete(id) {
  boardPendingWrites[`cards.${id}`] = deleteField();
  markBoardSaving();
}
function markBoardMetaDirty() {
  boardPendingWrites['title'] = boardData.title;
  markBoardSaving();
}
function markBoardSaving() {
  $('#board-save-status').textContent = 'Unsaved changes…';
}

function startBoardAutosaveLoop() {
  stopBoardAutosaveLoop();
  boardAutosaveInterval = setInterval(saveBoardIfDirty, 1200);
}
function stopBoardAutosaveLoop() {
  if (boardAutosaveInterval) clearInterval(boardAutosaveInterval);
  boardAutosaveInterval = null;
}

async function saveBoardIfDirty() {
  const keys = Object.keys(boardPendingWrites);
  if (keys.length === 0 || !boardId) return;
  const toSend = { ...boardPendingWrites, updatedAt: serverTimestamp() };
  boardPendingWrites = {};
  $('#board-save-status').textContent = 'Saving…';
  try {
    await updateDoc(doc(db, 'boards', boardId), toSend);
    $('#board-save-status').textContent = 'Saved';
  } catch (err) {
    delete toSend.updatedAt;
    boardPendingWrites = { ...toSend, ...boardPendingWrites };
    $('#board-save-status').textContent = 'Save failed — retrying…';
  }
}

window.addEventListener('resize', () => {
  if (!$('#view-editor').hidden) applyViewTransform();
});
