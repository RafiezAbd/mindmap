# Branchwork — User Guide

Branchwork is a workspace for two kinds of thinking: **mind maps** for
getting ideas out of your head, and **boards** for tracking work through
stages. This guide covers how to use both efficiently, including every
shortcut worth knowing.

> Looking for setup/hosting instructions instead? See `README.md`. This
> guide is for using the app once it's already running.

## Contents

- [Getting started](#getting-started)
- [Mind maps](#mind-maps)
- [Budgeting with mind maps](#budgeting-with-mind-maps)
- [Boards](#boards)
- [Sharing & real-time collaboration](#sharing--real-time-collaboration)
- [Keyboard shortcuts at a glance](#keyboard-shortcuts-at-a-glance)
- [Tips for working efficiently](#tips-for-working-efficiently)
- [Frequently asked questions](#frequently-asked-questions)

---

## Getting started

1. Open the app and sign in — either **Continue with Google**, or create
   an account with an email and password.
2. You'll land on your **workspace**: a dashboard listing every map and
   board you own or have been invited to, newest first.
3. Two buttons create something new: **+ New mind map** and
   **+ New board**. A third, **Join with a code**, is how you get added
   to something a collaborator started (see
   [Sharing](#sharing--real-time-collaboration)).
4. Click any card to open it. **← Maps** / **← Boards** in the top-left
   of the editor takes you back to the workspace at any time — your work
   is already saved by then, no separate "save" step needed.

---

## Mind maps

A mind map is a tree: one central idea in the middle, with branches
fanning out from it. Every branch gets its own color automatically.

### Adding and editing ideas

| Action | How |
|---|---|
| Add a child idea | Select a node, press **Tab**, or click **+** in its toolbar |
| Add a sibling idea | While renaming a node, press **Enter** |
| Rename a node | **Double-click** it, or click **✎** in its toolbar |
| Finish renaming | Press **Enter**, or click anywhere else |
| Delete a node (+ everything under it) | Select it and press **Delete**/**Backspace**, or click 🗑 — you'll be asked to confirm if it has children |

New nodes drop straight into rename mode — just start typing.

### Moving things around

- **Drag a node** to reposition it. Its entire branch (every node
  underneath it) moves along with it, keeping the whole subtree intact.
- **Drag empty canvas** to pan around a large map.
- **Scroll** to zoom, or use the **−** / **+** / reset buttons top-right.
  On trackpads, pinch to zoom works too.
- Click the small circle on a node with children to **collapse** that
  branch out of view (click again to expand). Handy for focusing on one
  part of a large map.

### Copy and paste a branch

Select any node and:

- **Ctrl+C** (or the ⧉ button) copies it and everything underneath it.
- Select a different node and press **Ctrl+V** (or 📥) to paste the
  copied branch in as a new child there — as many times as you like,
  each paste is an independent copy.

This is the fastest way to reuse a repeated structure (e.g. the same set
of sub-steps under several different branches) without rebuilding it by
hand each time.

### Color

- Each branch off the center gets its own color automatically, chosen so
  two people adding branches at the same moment never collide.
- Nodes get lighter the deeper they are in a branch, so you can tell at
  a glance how deep something sits.
- Any node can become its own color anchor: select it and click its
  color swatch to give it (and everything under it) a fresh color.
  Click again to reshuffle, or **right-click** the swatch to reset it
  back to its inherited color.

### Seeing who did what

Hover any node to see who added it, and who last edited its text (if
different), with a relative timestamp — useful on a shared map to see
what's changed and who's driving.

---

## Budgeting with mind maps

Mind maps double as a simple budgeting tool: give any node a dollar
amount, and every parent above it automatically shows the total of
everything underneath it — all the way up to the center.

1. Select a node and click **💲** in its toolbar.
2. Type a number and **Save**. That's now this node's own value.
3. Every node with a nonzero total (its own value, or the sum of its
   children's) shows that total as a small line underneath its label —
   automatically, with no extra step.
4. To remove a value from a node, open its 💲 popover again and click
   **Clear**.

A node can have both its own value *and* children with their own
values — its total is the sum of both. This means a category can have a
flat "misc" amount alongside itemized sub-branches, and everything still
rolls up correctly.

**Example**: a "Household" branch with children "Rent" ($1,200), "Groceries"
($400), and "Utilities" ($150) will show **$1,750** on the Household node
itself, with no manual addition required.

---

## Boards

A board is a Kanban-style set of columns (e.g. To Do / In Progress /
Done) containing cards you drag between them as work progresses.

### Columns

| Action | How |
|---|---|
| Add a column | Click **+ Add column** at the end of the row |
| Rename a column | Click its title and type |
| Reorder columns | Use the **←** / **→** arrows in a column's header |
| Delete a column | Click **✕** in its header — asks first if it has cards |

### Cards

| Action | How |
|---|---|
| Add a card | Click **+ Add card** at the bottom of a column |
| Rename a card | **Double-click** it and type |
| Move a card | **Drag** it — within a column to reorder, or into another column to move it there |
| Delete a card | Click 🗑 on the card |
| Set a due date | Click 📅 on the card, pick a date. Overdue dates show in red. Click **Clear** to remove it |
| Label a card with a color | Click 🎨 to cycle through preset colors (or back to none) |

A card left blank when you click away is automatically discarded rather
than left sitting empty on the board.

Hover a card to see who added or last edited it, same as mind map nodes.

---

## Sharing & real-time collaboration

Both maps and boards can be shared with anyone else who has an account —
edits sync between everyone within a fraction of a second, with no
refresh needed.

### Inviting someone

1. Open the map or board (you must be the **owner**).
2. Click **Share** in the top bar.
3. You'll see a 6-character invite code. Either:
   - Click **Copy** to grab just the code, or
   - Click **✉ Copy invite message** for a ready-to-send message with a
     link and the code included.
4. Send it to your collaborator however you like — chat, email, etc.

### Joining someone else's map or board

1. From your workspace, click **Join with a code**.
2. Paste in the code you were sent and click **Join**.
3. It's added to your workspace immediately, and you're taken straight
   into it.

### Managing collaborators

- The **Share** panel lists everyone currently on the map/board, with a
  **Remove** button next to each (owner only).
- **↻ New code** retires the current invite code and issues a new one —
  useful if you want to stop new people from joining without removing
  anyone already in.
- If you're a collaborator (not the owner) and want to leave, do it from
  your workspace: hover the item's card and click the eject icon.

---

## Keyboard shortcuts at a glance

**Mind maps**

| Shortcut | Action |
|---|---|
| `Tab` | Add a child idea to the selected node |
| `Enter` | Rename the selected node, or (while renaming) add a sibling |
| `Delete` / `Backspace` | Delete the selected node and its branch |
| `Ctrl+C` | Copy the selected node's branch |
| `Ctrl+V` | Paste the copied branch as a child of the selected node |
| `Escape` | Stop renaming without extra changes |
| Double-click a node | Rename it |
| Scroll / pinch | Zoom |

*(On Mac, `Ctrl+C`/`Ctrl+V` also work as written — no need to substitute `Cmd`.)*

**Boards** are drag-and-click driven rather than keyboard-driven — every
action has a visible button or icon on the card/column itself.

---

## Tips for working efficiently

- **Build fast with Tab and Enter**: select a node, hit `Tab` to add a
  child and start typing immediately, then `Enter` to add the next
  sibling without touching the mouse. You can rough out an entire branch
  this way before ever needing to drag anything into position.
- **Use copy/paste for repeated structure.** If several branches share
  the same shape (e.g. every "Project" branch needs "Goals / Tasks /
  Notes" underneath it), build it once and paste it wherever you need
  it instead of retyping.
- **Collapse what you're not working on.** On a large map, collapsing
  finished or reference-only branches keeps you focused and makes
  dragging/panning noticeably less cluttered.
- **Color your branches meaningfully**, not just decoratively — e.g. one
  color per project, or per person, or per priority level. Since color
  cascades down a branch automatically, you only have to set it once at
  the top of that branch.
- **Use amounts even outside of literal money.** The budgeting rollup
  works for any number you want summed up a tree — time estimates,
  points, quantities — not just currency.
- **On a shared map or board, check attribution before asking "who did
  this?"** — hovering the node or card usually answers it faster than
  asking in chat.
- **Regenerate your invite code** once everyone you want has joined, so
  the link/code you shared earlier stops working — a quick habit that
  keeps a "who can edit this" list clean over time.

---

## Frequently asked questions

**Can I use a map and a board for the same project?**
Yes — they're independent, so a common pattern is a mind map for
planning/structure and a board for execution/tracking, both shared with
the same collaborators.

**Is there an undo button?**
Not currently — deleting a branch or card asks for confirmation first
specifically because of this, so double-check before confirming a
delete.

**Can I export my data?**
Yes — **Export** in the top bar of either editor downloads the current
map or board as a `.json` file.

**Does someone need an account to view my map?**
Yes — everyone who accesses a map or board, owner or collaborator,
signs in first. There's no public/anonymous view link.

**What happens if two people edit the same node or card at the same
time?**
Both edits sync — the app is built to merge concurrent changes rather
than have one person's edit silently overwrite another's.
