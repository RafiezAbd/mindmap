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
  ['auth', 'dashboard', 'editor'].forEach(v => {
    $(`#view-${v}`).hidden = v !== name;
  });
}

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
  } else {
    showView('auth');
  }
});

// ============================================================
// DASHBOARD
// Maps live in a top-level `maps` collection so they can be
// shared. A user sees a map if they are the owner OR listed
// in its `collaborators` array.
// ============================================================
function mapsCollection() {
  return collection(db, 'maps');
}

async function loadDashboard() {
  const grid = $('#dash-grid');
  grid.innerHTML = '<p style="color:var(--text-lo); font-size:13px;">Loading…</p>';
  try {
    const ownedQ = query(mapsCollection(), where('ownerId', '==', currentUser.uid));
    const sharedQ = query(mapsCollection(), where('collaborators', 'array-contains', currentUser.uid));
    const [ownedSnap, sharedSnap] = await Promise.all([getDocs(ownedQ), getDocs(sharedQ)]);

    const seen = new Map();
    ownedSnap.forEach(d => seen.set(d.id, d.data()));
    sharedSnap.forEach(d => { if (!seen.has(d.id)) seen.set(d.id, d.data()); });

    grid.innerHTML = '';
    if (seen.size === 0) {
      $('#dash-empty').hidden = false;
      return;
    }
    $('#dash-empty').hidden = true;

    const entries = Array.from(seen.entries()).sort((a, b) => {
      const ta = a[1].updatedAt?.toMillis ? a[1].updatedAt.toMillis() : 0;
      const tb = b[1].updatedAt?.toMillis ? b[1].updatedAt.toMillis() : 0;
      return tb - ta;
    });
    entries.forEach(([id, data]) => grid.appendChild(renderMapCard(id, data)));
  } catch (err) {
    grid.innerHTML = `<p style="color:var(--danger); font-size:13px;">Couldn't load your maps: ${escapeHtml(err.message)}</p>`;
  }
}

function renderMapCard(id, data) {
  const card = document.createElement('div');
  card.className = 'map-card';
  const nodeCount = data.nodes ? Object.keys(data.nodes).length : 0;
  const updated = data.updatedAt && data.updatedAt.toDate ? data.updatedAt.toDate() : null;
  const owner = data.ownerId === currentUser.uid;
  card.innerHTML = `
    <div class="map-card-glow" style="background:radial-gradient(circle at 30% 20%, hsl(8 90% 60%), transparent 70%)"></div>
    ${owner ? '' : '<span class="map-card-badge">Shared</span>'}
    <button class="map-card-del" title="${owner ? 'Delete map' : 'Leave map'}">${owner ? '✕' : '⏏'}</button>
    <h3>${escapeHtml(data.title || 'Untitled map')}</h3>
    <div class="map-card-meta">${nodeCount} node${nodeCount === 1 ? '' : 's'} · ${updated ? relativeTime(updated) : 'just now'}</div>
  `;
  card.addEventListener('click', (e) => {
    if (e.target.closest('.map-card-del')) return;
    openMap(id);
  });
  card.querySelector('.map-card-del').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (owner) {
      if (!confirm(`Delete "${data.title || 'Untitled map'}"? This can't be undone.`)) return;
      await deleteDoc(doc(db, 'maps', id));
    } else {
      if (!confirm(`Leave "${data.title || 'Untitled map'}"? You'll need a new invite code to rejoin.`)) return;
      await updateDoc(doc(db, 'maps', id), { collaborators: arrayRemove(currentUser.uid) });
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
  if (!n.createdBy) return '';
  let lines = [`Added by ${n.createdByName || 'someone'} · ${relativeTime(new Date(n.createdAt))}`];
  if (n.updatedBy && n.updatedAt && n.updatedAt !== n.createdAt) {
    lines.push(`Edited by ${n.updatedByName || 'someone'} · ${relativeTime(new Date(n.updatedAt))}`);
  }
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

$('#btn-back').addEventListener('click', () => {
  stopAutosaveLoop();
  stopMapListener();
  $('#share-panel').hidden = true;
  showView('dashboard');
  loadDashboard();
});

// ------------------------------------------------------------
// Join a shared map by code
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
    const codeSnap = await getDoc(doc(db, 'joinCodes', code));
    if (!codeSnap.exists()) {
      errEl.textContent = "That code doesn't match any shared map.";
      errEl.hidden = false;
      return;
    }
    const { mapId: targetMapId } = codeSnap.data();
    await updateDoc(doc(db, 'maps', targetMapId), { collaborators: arrayUnion(currentUser.uid) });
    $('#join-modal').hidden = true;
    toast('Joined the map');
    openMap(targetMapId);
  } catch (err) {
    errEl.textContent = "Couldn't join that map. Double-check the code and try again.";
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
let unsubscribeMap = null;

// granular pending writes so autosave never clobbers a collaborator's
// concurrent edits with a stale full-document overwrite
let pendingWrites = {};   // e.g. { 'nodes.abc123': {...}, 'title': 'New title' }

const view = { scale: 1, panX: 0, panY: 0 };
const NODE_SPACING_X = 230;
const SIB_SPACING_Y = 76;

async function openMap(id) {
  mapId = id;
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
  updateShareButtonVisibility();
  showView('editor');
  centerView();
  renderAll();
  startAutosaveLoop();
  startMapListener();
}

function isOwner() {
  return mapData && mapData.ownerId === currentUser.uid;
}

function updateShareButtonVisibility() {
  $('#btn-share').textContent = isOwner() ? 'Share' : 'Shared map';
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
    if (id === editingId || id === draggingId) continue;      // actively being touched locally
    const incoming = remoteNodes[id];
    const local = mapData.nodes[id];
    if (!local || JSON.stringify(local) !== JSON.stringify(incoming)) {
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

  if (needsRender) renderAll();
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

function addChildNode(parentId, text = 'New idea') {
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
    createdAt: Date.now()
  };
  queueNodeWrite(id);
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
    edgeLayer.appendChild(makeEdgePath(mapData.nodes[n.parentId], n));
  });
  ids.forEach(id => nodeLayer.appendChild(makeNodeEl(id)));
  applyViewTransform();
  renderNodeActions();
}

function makeEdgePath(p, n) {
  const ns = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const dx = (n.x - p.x) * 0.5;
  const d = `M ${p.x} ${p.y} C ${p.x + dx} ${p.y}, ${n.x - dx} ${n.y}, ${n.x} ${n.y}`;
  ns.setAttribute('d', d);
  ns.setAttribute('class', 'edge-path');
  const color = colorForNode(n);
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
  el.textContent = n.text;
  el.dataset.id = id;
  const attrTip = attributionTooltip(n);
  if (attrTip) el.title = attrTip;
  if (id === editingId) el.contentEditable = 'true';

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

  attachNodeInteractions(el, id);
  return el;
}

function refreshNodeSelectionClasses() {
  $all('.node', nodeLayer).forEach(el => el.classList.toggle('is-selected', el.dataset.id === selectedId));
  renderNodeActions();
}

// ------------------------------------------------------------
// Node interactions: select, drag, edit, keyboard
// ------------------------------------------------------------
function attachNodeInteractions(el, id) {
  let dragging = false, moved = false, startX, startY, origX, origY;

  el.addEventListener('pointerdown', (e) => {
    if (el.isContentEditable) return;
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    dragging = true; moved = false;
    startX = e.clientX; startY = e.clientY;
    const n = mapData.nodes[id];
    origX = n.x; origY = n.y;
    draggingId = id;
  });

  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = (e.clientX - startX) / view.scale;
    const dy = (e.clientY - startY) / view.scale;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    if (!moved) return;
    const n = mapData.nodes[id];
    n.x = origX + dx;
    n.y = origY + dy;
    n.manual = true;
    el.classList.add('is-dragging');
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    updateEdgesFor();
  });

  el.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    draggingId = null;
    el.classList.remove('is-dragging');
    if (moved) { queueNodeWrite(id); }
    else { selectNode(id); }
  });

  el.addEventListener('dblclick', (e) => { e.stopPropagation(); startEditing(id); });
  el.addEventListener('blur', () => { if (editingId === id) commitEditing(el); });

  el.addEventListener('keydown', (e) => {
    if (editingId !== id) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEditing(el);
      const n = mapData.nodes[id];
      if (n.parentId) {
        const newId = addChildNode(n.parentId, '');
        renderAll();
        selectNode(newId);
        startEditing(newId);
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitEditing(el);
      const newId = addChildNode(id, '');
      renderAll();
      selectNode(newId);
      startEditing(newId);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      el.blur();
    }
  });
}

function updateEdgesFor() {
  edgeLayer.innerHTML = '';
  const ids = visibleNodeIds();
  ids.forEach(nid => {
    const n = mapData.nodes[nid];
    if (!n.parentId || !ids.includes(n.parentId)) return;
    edgeLayer.appendChild(makeEdgePath(mapData.nodes[n.parentId], n));
  });
}

function selectNode(id) { selectedId = id; refreshNodeSelectionClasses(); }

function startEditing(id) {
  if (editingId && editingId !== id) {
    const prevEl = nodeLayer.querySelector(`[data-id="${editingId}"]`);
    if (prevEl) commitEditing(prevEl);
  }
  editingId = id;
  selectedId = id;
  renderAll();
  requestAnimationFrame(() => {
    const el = nodeLayer.querySelector(`[data-id="${id}"]`);
    if (el) { el.focus(); document.getSelection().selectAllChildren(el); }
  });
}

function commitEditing(el) {
  const id = el.dataset.id;
  const n = mapData.nodes[id];
  const text = el.textContent.trim() || 'Untitled';
  if (n.text !== text) {
    n.text = text;
    n.updatedBy = currentUser.uid;
    n.updatedByName = currentUser.displayName || currentUser.email || 'Someone';
    n.updatedAt = Date.now();
    queueNodeWrite(id);
  }
  editingId = null;
  el.contentEditable = 'false';
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
    renderAll();
    selectNode(newId);
    startEditing(newId);
  });
  row.appendChild(addBtn);

  const renameBtn = document.createElement('button');
  renameBtn.textContent = '✎';
  renameBtn.title = 'Rename';
  renameBtn.addEventListener('click', (e) => { e.stopPropagation(); startEditing(selectedId); });
  row.appendChild(renameBtn);

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

canvasWrap.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.node') || e.target.closest('.node-actions')) return;
  panning = true;
  canvasWrap.classList.add('is-panning');
  panStartX = e.clientX; panStartY = e.clientY;
  panOrigX = view.panX; panOrigY = view.panY;
  selectedId = null;
  renderNodeActions();
  refreshNodeSelectionClasses();
});
window.addEventListener('pointermove', (e) => {
  if (!panning) return;
  view.panX = panOrigX + (e.clientX - panStartX);
  view.panY = panOrigY + (e.clientY - panStartY);
  applyViewTransform();
});
window.addEventListener('pointerup', () => { panning = false; canvasWrap.classList.remove('is-panning'); });

canvasWrap.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = canvasWrap.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const worldX = (mx - view.panX) / view.scale;
  const worldY = (my - view.panY) / view.scale;
  const delta = -e.deltaY * 0.0015;
  const newScale = Math.min(2.2, Math.max(0.25, view.scale * (1 + delta)));
  view.panX = mx - worldX * newScale;
  view.panY = my - worldY * newScale;
  view.scale = newScale;
  applyViewTransform();
}, { passive: false });

$('#btn-zoom-in').addEventListener('click', () => zoomBy(1.2));
$('#btn-zoom-out').addEventListener('click', () => zoomBy(1 / 1.2));
$('#btn-zoom-reset').addEventListener('click', centerView);
function zoomBy(factor) {
  const rect = canvasWrap.getBoundingClientRect();
  const mx = rect.width / 2, my = rect.height / 2;
  const worldX = (mx - view.panX) / view.scale;
  const worldY = (my - view.panY) / view.scale;
  view.scale = Math.min(2.2, Math.max(0.25, view.scale * factor));
  view.panX = mx - worldX * view.scale;
  view.panY = my - worldY * view.scale;
  applyViewTransform();
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
    renderAll();
    selectNode(newId);
    startEditing(newId);
  } else if (e.key === 'Enter' && selectedId) {
    e.preventDefault();
    startEditing(selectedId);
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
// Share panel (owner: invite code + collaborator list)
// ============================================================
$('#btn-share').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!isOwner()) { toast('Only the map owner can manage sharing.'); return; }
  const panel = $('#share-panel');
  if (!panel.hidden) { panel.hidden = true; return; }
  if (!mapData.shareCode) await regenerateShareCode(/*silent=*/true);
  renderSharePanel();
  panel.hidden = false;
});
document.addEventListener('click', (e) => {
  const panel = $('#share-panel');
  if (!panel.hidden && !panel.contains(e.target) && e.target.id !== 'btn-share') panel.hidden = true;
});

function renderSharePanel() {
  $('#share-code-value').textContent = mapData.shareCode || '------';
  renderShareCollabList();
}

function renderShareCollabList() {
  const list = $('#share-collab-list');
  const collabs = mapData.collaborators || [];
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
      mapData.collaborators = mapData.collaborators.filter(u => u !== uidVal);
      await updateDoc(doc(db, 'maps', mapId), { collaborators: arrayRemove(uidVal) });
      renderShareCollabList();
    });
    row.appendChild(removeBtn);
    list.appendChild(row);
  });
}

async function regenerateShareCode(silent) {
  const oldCode = mapData.shareCode;
  const newCode = makeShareCode();
  mapData.shareCode = newCode;
  await setDoc(doc(db, 'joinCodes', newCode), { mapId, ownerId: currentUser.uid });
  await updateDoc(doc(db, 'maps', mapId), { shareCode: newCode });
  if (oldCode) { try { await deleteDoc(doc(db, 'joinCodes', oldCode)); } catch (_) { /* ignore */ } }
  if (!silent) toast('New invite code generated');
}

$('#share-regen').addEventListener('click', async (e) => {
  e.stopPropagation();
  await regenerateShareCode(false);
  renderSharePanel();
});

$('#share-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(mapData.shareCode || '');
    toast('Code copied');
  } catch (_) {
    toast(mapData.shareCode || '');
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

window.addEventListener('beforeunload', () => { if (Object.keys(pendingWrites).length) saveIfDirty(); });

// ============================================================
// Export
// ============================================================
$('#btn-export').addEventListener('click', () => {
  if (!mapData) return;
  const blob = new Blob([JSON.stringify(mapData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(mapData.title || 'mindmap').replace(/[^a-z0-9-_]+/gi, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Map exported as JSON');
});

window.addEventListener('resize', () => {
  if (!$('#view-editor').hidden) applyViewTransform();
});
