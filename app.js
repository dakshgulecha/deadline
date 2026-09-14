const storageKey = "deadline-workspace-v3";
const labels = {
  registration: "Registration",
  testRegistration: "Test registration",
  application: "Application",
  test: "Test date",
};

const starterData = {
  deadlines: [],
  notes: [],
  selectedNoteId: null,
};

let state = loadState();
let saveTimer;
let cloud = { enabled: false, url: "", key: "", updatedAt: "", pollTimer: null };

function loadState() {
  try { return JSON.parse(localStorage.getItem(storageKey)) || structuredClone(starterData); }
  catch { return structuredClone(starterData); }
}
function persist() {
  localStorage.setItem(storageKey, JSON.stringify(state));
  const status = document.querySelector("#save-status");
  if (cloud.enabled) syncToCloud();
  else status.textContent = "Saved locally";
}
function scheduleSave() {
  document.querySelector("#save-status").textContent = cloud.enabled ? "Syncing…" : "Saving…";
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persist, 250);
}

function normaliseState(value) {
  return {
    deadlines: Array.isArray(value?.deadlines) ? value.deadlines : [],
    notes: Array.isArray(value?.notes) ? value.notes : [],
    selectedNoteId: value?.selectedNoteId || null,
  };
}

function cloudHeaders() {
  return {
    apikey: cloud.key,
    Authorization: `Bearer ${cloud.key}`,
    "Content-Type": "application/json",
  };
}

async function loadFromCloud() {
  const response = await fetch(`${cloud.url}/rest/v1/app_state?id=eq.1&select=data,updated_at`, { headers: cloudHeaders() });
  if (!response.ok) throw new Error("Could not load shared data");
  const [record] = await response.json();
  if (!record) return;
  if (record.updated_at !== cloud.updatedAt) {
    state = normaliseState(record.data);
    cloud.updatedAt = record.updated_at;
    localStorage.setItem(storageKey, JSON.stringify(state));
    renderDeadlines();
    renderNotes();
    renderEditor();
  }
}

async function syncToCloud() {
  document.querySelector("#save-status").textContent = "Syncing…";
  try {
    const response = await fetch(`${cloud.url}/rest/v1/app_state?id=eq.1`, {
      method: "PATCH",
      headers: { ...cloudHeaders(), Prefer: "return=representation" },
      body: JSON.stringify({ data: state, updated_at: new Date().toISOString() }),
    });
    if (!response.ok) throw new Error("Could not save shared data");
    const [record] = await response.json();
    cloud.updatedAt = record?.updated_at || "";
    document.querySelector("#save-status").textContent = "Synced";
  } catch {
    document.querySelector("#save-status").textContent = "Saved locally";
  }
}

async function startCloudSync() {
  try {
    document.querySelector("#save-status").textContent = "Connecting…";
    const response = await fetch("/api/config", { cache: "no-store" });
    const config = await response.json();
    if (!response.ok || !config.configured) throw new Error("Cloud not configured");
    cloud = { ...cloud, enabled: true, url: config.url.replace(/\/$/, ""), key: config.key };
    await loadFromCloud();
    document.querySelector("#save-status").textContent = "Synced";
    cloud.pollTimer = window.setInterval(() => loadFromCloud().catch(() => {}), 8000);
  } catch {
    document.querySelector("#save-status").textContent = "Saved locally";
  }
}
function getToday() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function dateFromISO(value) { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); }
function daysAway(value) { return Math.round((dateFromISO(value) - getToday()) / 86400000); }
function formatDate(value) { return dateFromISO(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function formatLongDate(value) { return dateFromISO(value).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }); }
function countdownText(days) { if (days < 0) return "Past"; if (days === 0) return "Now"; if (days === 1) return "1d"; return `${days}d`; }
function spokenCountdown(days) { if (days < 0) return "Passed"; if (days === 0) return "Today"; if (days === 1) return "Tomorrow"; return `${days} days remaining`; }
function urgencyClass(days) { return days <= 3 ? "critical" : days <= 14 ? "warning" : ""; }
function dateGroup(value) { const days = daysAway(value); if (days === 0) return "Today"; if (days === 1) return "Tomorrow"; if (days > 1 && days < 8) return "This week"; return formatLongDate(value); }
function notePreview(note) {
  const preview = document.createElement("div");
  preview.innerHTML = note.body;
  preview.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
  preview.querySelectorAll("div, p, li").forEach(el => el.append("\n"));
  const lines = (preview.textContent || "").split("\n").map(line => line.replace(/\s+/g, " ").trim());
  return lines.find(line => line.length > 0) || "Empty note";
}
function formatUpdated(value) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value)); }

function renderDeadlines() {
  const list = document.querySelector("#deadline-list");
  const deadlines = [...state.deadlines].sort((a, b) => a.date.localeCompare(b.date));
  document.querySelector("#deadline-count").textContent = `${deadlines.filter(d => !d.complete).length} open`;
  list.innerHTML = "";
  if (!deadlines.length) {
    list.innerHTML = '<div class="empty-list">No deadlines yet. Add one when you are ready.</div>';
    return;
  }
  let previousGroup = "";
  for (const deadline of deadlines) {
    const currentGroup = dateGroup(deadline.date);
    if (currentGroup !== previousGroup) {
      const group = document.createElement("div");
      group.className = "date-group-label";
      group.textContent = currentGroup;
      list.append(group);
      previousGroup = currentGroup;
    }
    const fragment = document.querySelector("#deadline-template").content.cloneNode(true);
    const item = fragment.querySelector(".deadline-item");
    const row = fragment.querySelector(".deadline-row");
    const days = daysAway(deadline.date);
    item.dataset.id = deadline.id;
    if (deadline.complete) item.classList.add("is-complete");
    fragment.querySelector(".deadline-date").textContent = formatDate(deadline.date);
    fragment.querySelector(".deadline-main strong").textContent = deadline.title;
    fragment.querySelector(".deadline-main small").textContent = deadline.institution || "Personal";
    const type = fragment.querySelector(".deadline-type");
    type.textContent = labels[deadline.category];
    type.classList.add(deadline.category);
    const countdown = fragment.querySelector(".countdown");
    countdown.textContent = countdownText(days);
    countdown.title = spokenCountdown(days);
    const urgency = urgencyClass(days);
    if (urgency) countdown.classList.add(urgency);
    const details = fragment.querySelector(".deadline-details");
    renderDeadlineDetails(details, deadline);
    row.addEventListener("click", (event) => {
      if (event.target.closest(".completion")) { toggleComplete(deadline.id); return; }
      const open = details.hidden;
      details.hidden = !open;
      item.classList.toggle("expanded", open);
    });
    fragment.querySelector(".completion").addEventListener("click", event => { event.stopPropagation(); toggleComplete(deadline.id); });
    list.append(fragment);
  }
}

function renderDeadlineDetails(details, deadline) {
  details.innerHTML = `<div class="detail-header"><button class="edit-reminder" type="button">Edit</button></div><span class="detail-label">Details</span>${escapeHtml(deadline.details || "No extra details yet.")}<span class="detail-label">Link</span><a class="details-link" href="${escapeAttr(deadline.link || "#")}" target="_blank" rel="noreferrer">${deadline.link ? "Open resource ↗" : "No link added"}</a><span class="detail-label">Notes</span>${escapeHtml(deadline.notes || "No notes yet.")}`;
  details.querySelector(".edit-reminder").addEventListener("click", event => { event.stopPropagation(); renderReminderEditor(details, deadline); });
}

function renderReminderEditor(details, deadline) {
  details.innerHTML = `<form class="reminder-edit-form">
    <label>Title<input name="title" value="${escapeAttr(deadline.title)}" required></label>
    <label>Date<input name="date" type="date" value="${escapeAttr(deadline.date)}" required></label>
    <label>Institution<input name="institution" value="${escapeAttr(deadline.institution || "")}"></label>
    <label>Type<select name="category">${Object.entries(labels).map(([value, label]) => `<option value="${value}" ${deadline.category === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
    <label class="wide">Details<textarea name="details">${escapePlain(deadline.details || "")}</textarea></label>
    <label class="wide">Link<input name="link" type="url" value="${escapeAttr(deadline.link || "")}" placeholder="https://"></label>
    <label class="wide">Notes<textarea name="notes">${escapePlain(deadline.notes || "")}</textarea></label>
    <div class="reminder-form-actions"><button class="danger-button" type="button" data-action="delete">Delete deadline</button><button class="text-button" type="button" data-action="cancel">Cancel</button><button class="primary-button" type="submit">Save changes</button></div>
  </form>`;
  const form = details.querySelector("form");
  form.querySelector('[data-action="cancel"]').addEventListener("click", () => renderDeadlineDetails(details, deadline));
  form.querySelector('[data-action="delete"]').addEventListener("click", () => renderDeadlineDeleteConfirm(details, deadline));
  form.addEventListener("submit", event => {
    event.preventDefault();
    const values = new FormData(form);
    for (const key of ["title", "date", "institution", "category", "details", "link", "notes"]) deadline[key] = String(values.get(key) || "").trim();
    persist();
    renderDeadlines();
  });
}

function renderDeadlineDeleteConfirm(details, deadline) {
  details.innerHTML = `<div class="delete-confirm"><span class="detail-label">Delete deadline?</span><p>This will permanently remove “${escapeHtml(deadline.title)}”.</p><div class="reminder-form-actions"><button class="text-button" type="button" data-action="cancel">Keep it</button><button class="primary-button delete-confirm-button" type="button" data-action="confirm">Delete</button></div></div>`;
  details.querySelector('[data-action="cancel"]').addEventListener("click", () => renderReminderEditor(details, deadline));
  details.querySelector('[data-action="confirm"]').addEventListener("click", () => {
    state.deadlines = state.deadlines.filter(item => item.id !== deadline.id);
    persist();
    renderDeadlines();
  });
}

function escapeHtml(value) { const node = document.createElement("div"); node.textContent = value; return node.innerHTML.replace(/\n/g, "<br>"); }
function escapePlain(value) { const node = document.createElement("div"); node.textContent = value; return node.innerHTML; }
function escapeAttr(value) { return String(value).replace(/"/g, "&quot;"); }
function toggleComplete(id) { const item = state.deadlines.find(d => d.id === id); item.complete = !item.complete; persist(); renderDeadlines(); }

function renderNotes() {
  const list = document.querySelector("#note-list");
  list.innerHTML = "";
  const notes = [...state.notes].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  for (const note of notes) {
    const row = document.createElement("button");
    row.className = `note-row ${note.id === state.selectedNoteId ? "active" : ""}`;
    row.innerHTML = `<strong>${escapeHtml(note.title || "Untitled note")}</strong><small>${escapeHtml(notePreview(note))}</small>`;
    row.addEventListener("click", () => { state.selectedNoteId = note.id; persist(); renderNotes(); renderEditor(); });
    list.append(row);
  }
  const create = document.createElement("input");
  create.className = "new-note-field";
  create.placeholder = "Write a new note…";
  create.setAttribute("aria-label", "Create a new note");
  create.addEventListener("keydown", event => { if (event.key === "Enter" && create.value.trim()) createNote(create.value.trim()); });
  list.append(create);
}
function renderEditor() {
  const note = state.notes.find(n => n.id === state.selectedNoteId);
  const empty = document.querySelector("#editor-empty");
  const editor = document.querySelector("#editor-content");
  empty.hidden = Boolean(note); editor.hidden = !note;
  if (!note) {
    document.querySelector("#note-title").value = "";
    document.querySelector("#note-body").innerHTML = "";
    document.querySelector("#note-date").textContent = "";
    return;
  }
  document.querySelector("#note-title").value = note.title;
  document.querySelector("#note-body").innerHTML = toEditorHtml(note.body);
  document.querySelector("#note-date").textContent = `Edited ${formatUpdated(note.updatedAt)}`;
}
function createNote(title = "") {
  const note = { id: crypto.randomUUID(), title, body: "", updatedAt: new Date().toISOString() };
  state.notes.push(note); state.selectedNoteId = note.id; persist(); renderNotes(); renderEditor();
  document.querySelector("#note-title").focus();
}
function updateActiveNote(property, value) {
  const note = state.notes.find(n => n.id === state.selectedNoteId);
  if (!note) return;
  note[property] = value; note.updatedAt = new Date().toISOString(); scheduleSave(); renderNotes();
  document.querySelector("#note-date").textContent = "Edited just now";
}
function toEditorHtml(value) {
  if (/<[a-z][\s\S]*>/i.test(value)) return value;
  return escapeHtml(value);
}
function insertChecklist() {
  const editor = document.querySelector("#note-body");
  editor.focus();
  const anchor = window.getSelection()?.anchorNode;
  const anchorElement = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
  if (anchorElement?.closest("ul:not(.checklist)")) document.execCommand("insertUnorderedList");
  document.execCommand("insertHTML", false, '<ul class="checklist"><li><input type="checkbox"><span>Checklist item</span></li></ul>');
  updateActiveNote("body", editor.innerHTML);
}
function deleteActiveNote() {
  if (!state.selectedNoteId) return;
  state.notes = state.notes.filter(n => n.id !== state.selectedNoteId);
  state.selectedNoteId = state.notes[0]?.id || null;
  persist(); renderNotes(); renderEditor();
}

function setTodayLabel() { document.querySelector("#today-label").textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date()); }
function addDeadline() {
  const title = document.querySelector("#new-deadline-title").value.trim();
  const date = document.querySelector("#new-deadline-date").value;
  if (!title || !date) { document.querySelector("#new-deadline-title").focus(); return; }
  state.deadlines.push({
    id: crypto.randomUUID(),
    title,
    date,
    institution: document.querySelector("#new-deadline-institution").value.trim(),
    category: document.querySelector("#new-deadline-category").value,
    details: document.querySelector("#new-deadline-details").value.trim(),
    link: document.querySelector("#new-deadline-link").value.trim(),
    notes: document.querySelector("#new-deadline-notes").value.trim(),
    complete: false,
  });
  persist(); renderDeadlines(); document.querySelector("#deadline-form").hidden = true;
  for (const id of ["new-deadline-title", "new-deadline-date", "new-deadline-institution", "new-deadline-details", "new-deadline-link", "new-deadline-notes"]) document.querySelector(`#${id}`).value = "";
}

function currentSplit() { return Number.parseFloat(getComputedStyle(document.querySelector("#workspace")).getPropertyValue("--tracker-width")) || 56; }
function setSplit(value) {
  const workspace = document.querySelector("#workspace");
  const available = workspace.getBoundingClientRect().width;
  const minimum = Math.max(38, (420 / available) * 100);
  const maximum = Math.min(68, 100 - (428 / available) * 100);
  const split = Math.max(minimum, Math.min(maximum, value));
  workspace.style.setProperty("--tracker-width", `${split}%`);
  document.querySelector("#resize-handle").setAttribute("aria-valuenow", String(Math.round(split)));
  localStorage.setItem("deadline-split-v1", String(split));
}
function setSplitFromPointer(clientX) {
  const workspace = document.querySelector("#workspace");
  const bounds = workspace.getBoundingClientRect();
  setSplit(((clientX - bounds.left) / bounds.width) * 100);
}

document.querySelector("#show-deadline-form").addEventListener("click", () => { const form = document.querySelector("#deadline-form"); form.hidden = !form.hidden; if (!form.hidden) document.querySelector("#new-deadline-title").focus(); });
document.querySelector("#cancel-deadline").addEventListener("click", () => { document.querySelector("#deadline-form").hidden = true; });
document.querySelector("#save-deadline").addEventListener("click", addDeadline);
document.querySelector("#toggle-notes").addEventListener("click", () => {
  const workspace = document.querySelector("#workspace");
  const notesPanel = document.querySelector(".notes-panel");
  const hidden = workspace.classList.toggle("notes-hidden");
  document.querySelector("#toggle-notes").textContent = hidden ? "▣" : "◧";
  document.querySelector("#toggle-notes").setAttribute("aria-label", hidden ? "Show notes" : "Hide notes");
  document.querySelector("#toggle-notes").setAttribute("title", hidden ? "Show notes" : "Hide notes");
  notesPanel.inert = hidden;
  notesPanel.setAttribute("aria-hidden", String(hidden));
});
document.querySelector("#note-title").addEventListener("input", event => updateActiveNote("title", event.target.value));
document.querySelector("#note-body").addEventListener("input", event => updateActiveNote("body", event.currentTarget.innerHTML));
document.querySelector("#note-body").addEventListener("change", event => { if (event.target.matches('input[type="checkbox"]')) updateActiveNote("body", event.currentTarget.innerHTML); });
document.querySelector("#note-body").addEventListener("keydown", event => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const startNode = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const li = startNode?.closest("li");
  const span = li?.querySelector(":scope > span");
  if (!li || !li.closest("ul.checklist") || !span) return;
  event.preventDefault();

  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(span);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const afterRange = document.createRange();
  afterRange.selectNodeContents(span);
  afterRange.setStart(range.startContainer, range.startOffset);
  const beforeText = beforeRange.toString();
  const afterText = afterRange.toString();

  span.textContent = beforeText;

  const newItem = document.createElement("li");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  const newSpan = document.createElement("span");
  newSpan.textContent = afterText;
  newItem.append(checkbox, newSpan);
  li.after(newItem);

  const newRange = document.createRange();
  if (newSpan.firstChild) newRange.setStart(newSpan.firstChild, 0);
  else newRange.setStart(newSpan, 0);
  newRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(newRange);

  updateActiveNote("body", document.querySelector("#note-body").innerHTML);
});
document.querySelector("#bullet-list").addEventListener("mousedown", event => event.preventDefault());
document.querySelector("#bullet-list").addEventListener("click", () => { const editor = document.querySelector("#note-body"); editor.focus(); document.execCommand("insertUnorderedList"); updateActiveNote("body", editor.innerHTML); });
document.querySelector("#checklist").addEventListener("mousedown", event => event.preventDefault());
document.querySelector("#checklist").addEventListener("click", insertChecklist);
document.querySelector("#delete-note").addEventListener("click", deleteActiveNote);

const resizeHandle = document.querySelector("#resize-handle");
const storedSplit = Number.parseFloat(localStorage.getItem("deadline-split-v1"));
if (Number.isFinite(storedSplit)) setSplit(storedSplit);
resizeHandle.addEventListener("pointerdown", event => {
  if (window.matchMedia("(max-width: 980px)").matches) return;
  resizeHandle.classList.add("is-resizing");
  resizeHandle.setPointerCapture(event.pointerId);
  setSplitFromPointer(event.clientX);
});
resizeHandle.addEventListener("pointermove", event => { if (resizeHandle.hasPointerCapture(event.pointerId)) setSplitFromPointer(event.clientX); });
resizeHandle.addEventListener("pointerup", event => { resizeHandle.releasePointerCapture(event.pointerId); resizeHandle.classList.remove("is-resizing"); });
resizeHandle.addEventListener("keydown", event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  setSplit(currentSplit() + (event.key === 'ArrowLeft' ? -2 : 2));
});

setTodayLabel();
renderDeadlines();
renderNotes();
renderEditor();
startCloudSync();