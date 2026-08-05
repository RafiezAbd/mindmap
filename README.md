# Branchwork — a mind‑mapping web app

Type an idea, hit Tab, and watch it branch. Colors identify branches (topics)
and shift with depth so levels are easy to tell apart at a glance. Sign in
with email or Google, and invite someone to a map with a 6-character code —
edits sync between you in real time. Everything is plain HTML/CSS/JS, no
build step, with Firebase for accounts and storage.

## What's inside

```
index.html          the whole app shell (sign in, dashboard, editor)
styles.css           design + theme
app.js               all the logic (auth, Firestore, canvas, real-time sync)
firebase-config.js   YOUR Firebase project keys go here
firestore.rules      security rules to paste into the Firebase console
README.md            this file
```

## 1. Create a Firebase project (free tier is enough)

1. Go to https://console.firebase.google.com and click **Add project**.
2. Click the **</> (Web)** icon to register a web app, and copy the
   `firebaseConfig` object it shows you.
3. Paste those values into `firebase-config.js` in this folder. This is safe
   to make public — Firebase web keys aren't secret; access is controlled by
   the security rules from step 3 below, not by hiding this file.

## 2. Turn on sign-in methods

**Build → Authentication → Get started → Sign-in method**, then enable:

- **Email/Password** — turn it on and save.
- **Google** — turn it on, pick a support email, and save.

## 3. Turn on Firestore and lock it down

1. **Build → Firestore Database → Create database** (production mode, any
   region).
2. Open the **Rules** tab, replace the contents with everything in
   `firestore.rules` from this folder, and **Publish**.

This rule set is what makes sharing safe:
- A map is only readable/writable by its owner or someone already in its
  `collaborators` list.
- The **one** exception: any signed-in user is allowed to add *their own*
  uid to a map's `collaborators` array — nothing else about the document —
  which is exactly what happens when someone joins with an invite code.
- Invite codes live in a separate `joinCodes` collection as tiny documents
  (`{ mapId, ownerId }|`). Looking one up requires already knowing the exact
  code (this is a direct document fetch, not a searchable listing), so codes
  work like a lightweight invite link/password.

## 4. Try it locally

ES module imports need a real server, not `file://`:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

Sign in (email or Google), create a map, add a few ideas, refresh to confirm
they saved. To test collaboration, sign in as a second account in another
browser (or an incognito window), open **Join with a code**, and paste the
code from the first account's **Share** button.

## 5. Host it on GitHub Pages

1. Push these files to a GitHub repo (root of the `main` branch works fine).
2. **Settings → Pages → Build and deployment → Source: Deploy from a
   branch → `main` / `(root)` → Save.**
3. Your app is now live at `https://yourname.github.io/your-repo/`.
4. Back in Firebase: **Authentication → Settings → Authorized domains → Add
   domain**, and add your `github.io` domain — both email/password and
   Google sign-in need this or they'll be blocked.

Fully static, so GitHub Pages needs nothing else configured.

## Using the app

**Solo editing**
- **Click** a node to select it — a small toolbar appears above it.
- **Tab** or the **+** button adds a child idea.
- **Enter** on a selected node starts renaming it; **Enter** while typing
  adds a sibling idea.
- **Double-click**, or the pencil icon, renames a node in place.
- **Delete/Backspace**, or the trash icon, removes a node and everything
  under it (asks first if it has children).
- **Drag** a node to reposition it by hand.
- **Drag empty canvas** to pan, **scroll** to zoom, or use the zoom buttons.
- The small circle on a node with children **collapses/expands** that branch.
- **Export** downloads the current map as `.json`.

**Sharing a map**
- Click **Share** (owners only) to get a 6-character invite code — **Copy**
  it and send it to a collaborator however you like (chat, email, etc).
- They click **Join with a code** on their own dashboard and paste it in.
- From then on both of you see the same map, and edits sync between you
  live — no refresh needed.
- **↻ New code** retires the old code (anyone who hasn't joined yet with it
  can no longer use it) and issues a new one.
- The share panel lists current collaborators with a **Remove** button.
- A collaborator can leave from the dashboard via the eject icon on the
  map's card.

## Color logic

Each branch off the central idea gets its own hue, derived from that
branch's own id — not a shared counter — so two people adding branches at
the same moment never end up with colliding colors. Every node further down
that branch keeps the same hue but gets a bit darker/less saturated with
each level: color says *which topic*, shade says *how deep*. Reshuffle an
individual branch's color from its toolbar if you want a different hue.

## How real-time sync works

Each map is one Firestore document at `/maps/{mapId}`. Rather than
overwriting the whole document on every save (which would let two people's
autosaves stomp each other), the app only ever writes the specific fields
that changed — e.g. `nodes.abc123` for one edited node — using Firestore's
dot-path field updates. A live listener (`onSnapshot`) pushes every
collaborator's changes to everyone else within a fraction of a second, and
incoming changes are merged in per-node, skipping any node you're actively
dragging or editing at that instant so your in-progress keystroke or drag
never gets overwritten mid-action.

## Data model

```jsonc
// /maps/{mapId}
{
  "title": "Launch plan",
  "ownerId": "uid_of_creator",
  "ownerEmail": "owner@example.com",
  "collaborators": ["uid_of_invited_person"],
  "shareCode": "K7QUXP",
  "rootId": "root",
  "nodes": {
    "root": { "text": "Central idea", "parentId": null, "x": 0, "y": 0, "depth": 0 },
    "abc123": { "text": "Branch one", "parentId": "root", "x": 230, "y": 0, "depth": 1, "side": "right", "branch": "abc123" }
  }
}

// /joinCodes/{code}
{ "mapId": "...", "ownerId": "..." }
```

## Notes / things you might want to extend

- No password-reset flow yet — easy to add with Firebase's
  `sendPasswordResetEmail`.
- No live cursors or "who's online" presence — collaborators' edits appear
  in real time, but you can't see where someone else's cursor is right now.
- No image export (PNG/PDF) — export is JSON-only.
- No expiry on invite codes — regenerate a map's code any time to invalidate
  the old one.
- No offline support — a connection is needed to save and sync.
