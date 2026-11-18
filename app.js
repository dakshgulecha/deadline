import { fingerprint, mergeStates, normaliseState, stamp } from "./shared/merge.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const STORAGE_KEY = "deadline-workspace-v4";
const LEGACY_STORAGE_KEYS = ["deadline-workspace-v3"];
const SELECTED_NOTE_KEY = "deadline-selected-note";
const VIEW_KEY = "deadline-view";
const SPLIT_KEY = "deadline-split-v1";
const THEME_KEY = "deadline-theme";

const labels = {
  registration: "Registration",
  testRegistration: "Test registration",
  application: "Application",
  test: "Test date",
  reminder: "Reminder",
};
const categoryLabel = category => labels[category] || "Other";

const tabletQuery = matchMedia("(max-width: 980px)");
const phoneQuery = matchMedia("(max-width: 620px)");
const coarsePointer = matchMedia("(pointer: coarse)");

// ---------------------------------------------------------------- utilities

function readLocal(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writeLocal(key, value) {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch {}
}
const nowISO = () => new Date().toISOString();
function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, "0")).join("");
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function escapeHtml(value) { const node = document.createElement("div"); node.textContent = value; return node.innerHTML.replace(/\n/g, "<br>"); }
function escapeAttr(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Only http(s) links are allowed. "example.com" becomes "https://example.com".
function cleanLink(value) {
  let link = String(value || "").trim();
  if (!link) return "";
  if (!/^[a-z][a-z\d+.-]*:/i.test(link)) link = `https://${link}`;
  try {
    const url = new URL(link);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch { return ""; }
}

// Notes are stored as HTML (lists + checklists). Everything outside a small
// allow-list is stripped before it is saved or shown, so a note can never run code.
const ALLOWED_TAGS = new Set(["DIV", "P", "BR", "UL", "OL", "LI", "B", "STRONG", "I", "EM", "U", "S"]);
const DROPPED_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "FRAME", "OBJECT", "EMBED", "TEMPLATE", "SVG", "MATH", "NOSCRIPT", "TEXTAREA", "SELECT", "BUTTON", "INPUT", "LINK", "META", "IMG", "PICTURE", "VIDEO", "AUDIO", "SOURCE", "CANVAS", "FORM", "HEAD", "TITLE"]);
const ALLOWED_CLASSES = new Set(["checklist", "checked"]);
function cleanNode(parent) {
  for (const node of [...parent.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE) continue;
    if (node.nodeType !== Node.ELEMENT_NODE) { node.remove(); continue; }
    const tag = node.tagName.toUpperCase();
    if (DROPPED_TAGS.has(tag)) { node.remove(); continue; }
    cleanNode(node);
    if (!ALLOWED_TAGS.has(tag)) { node.replaceWith(...node.childNodes); continue; }
    for (const attribute of [...node.attributes]) if (attribute.name !== "class") node.removeAttribute(attribute.name);
    const classes = [...node.classList].filter(name => ALLOWED_CLASSES.has(name));
    if (classes.length) node.className = classes.join(" ");
    else node.removeAttribute("class");
  }
}
function sanitizeNoteHtml(html) {
  // <template> content is inert: nothing in it loads or runs while we clean it.
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  cleanNode(template.content);
  return template.innerHTML;
}
function toEditorHtml(value) {
  const text = String(value || "");
  return sanitizeNoteHtml(/<[a-z][\s\S]*>/i.test(text) ? text : escapeHtml(text));
}
function notePreview(note) {
  const template = document.createElement("template");
  template.innerHTML = toEditorHtml(note.body);
  const fragment = template.content;
  fragment.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
  fragment.querySelectorAll("div, p, li, ul, ol").forEach(node => { node.before("\n"); node.append("\n"); });
  const lines = (fragment.textContent || "").split("\n").map(line => line.replace(/\s+/g, " ").trim());
  return lines.find(line => line.length > 0) || "Empty note";
}

// ------------------------------------------------------------------ dates

function getToday() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function dateFromISO(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return getToday();
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}
function daysAway(value) { return Math.round((dateFromISO(value) - getToday()) / 86400000); }
function formatDate(value) { return dateFromISO(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function formatLongDate(value) { return dateFromISO(value).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }); }
function formatTime(value) {
  const match = /^(\d{2}):(\d{2})/.exec(value || "");
  if (!match) return "";
  return new Date(2000, 0, 1, Number(match[1]), Number(match[2])).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function formatUpdated(value) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(stamp(value) || Date.now())); }
function countdownText(days) { if (days < 0) return "Past"; if (days === 0) return "Now"; return `${days}d`; }
function spokenCountdown(days) { if (days < 0) return "Passed"; if (days === 0) return "Today"; if (days === 1) return "Tomorrow"; return `${days} days remaining`; }
function urgencyClass(days) { return days <= 3 ? "critical" : days <= 14 ? "warning" : ""; }
function dateGroup(value) {
  const days = daysAway(value);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1 && days < 8) return "This week";
  return formatLongDate(value);
}
function setTodayLabel() { $("#today-label").textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date()); }

// ------------------------------------------------------------------ state

let state = loadState();
let selectedNoteId = readLocal(SELECTED_NOTE_KEY); // per device, never synced

function loadState() {
  for (const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
    const raw = readLocal(key);
    if (!raw) continue;
    try { return normaliseState(JSON.parse(raw)); } catch {}
  }
  return normaliseState({});
}
function saveLocal() { writeLocal(STORAGE_KEY, JSON.stringify(state)); }
function findDeadline(id) { return state.deadlines.find(item => item.id === id); }
function findNote(id) { return state.notes.find(item => item.id === id); }
function markDeleted(id) { state.deleted[id] = nowISO(); }
function sortedNotes() { return [...state.notes].sort((a, b) => stamp(b.updatedAt) - stamp(a.updatedAt)); }

// Every local edit goes through here: save on this device right away, sync shortly after.
function changed(delay = 600) {
  saveLocal();
  queuePush(delay);
}

// ------------------------------------------------------------------- sync

const sync = { mode: "connecting", inFlight: false, again: false, pushTimer: null, retryTimer: null, retryDelay: 0 };

class SyncError extends Error {
  constructor(kind) { super(kind); this.kind = kind; }
}

async function api(method, body, { keepalive = false } = {}) {
  let response;
  try {
    response = await fetch("/api/state", {
      method,
      cache: "no-store",
      credentials: "same-origin",
      keepalive,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new SyncError("offline"); }
  if (response.status === 401) throw new SyncError("locked");
  if (response.status === 404 || response.status === 503) throw new SyncError("unavailable");
  if (!response.ok) throw new SyncError("failed");
  try { return await response.json(); } catch { throw new SyncError("unavailable"); }
}

function showSyncStatus() {
  const fixed = { locked: "Locked", local: "On this device", offline: "Offline · saved here", connecting: "Connecting…" }[sync.mode];
  $("#save-status").textContent = fixed || (sync.inFlight || sync.pushTimer ? "Syncing…" : "Synced");
}

function queuePush(delay = 600) {
  clearTimeout(sync.pushTimer);
  sync.pushTimer = setTimeout(() => { sync.pushTimer = null; push(); }, delay);
  showSyncStatus();
}

function finishRequest() {
  sync.inFlight = false;
  if (sync.again) { sync.again = false; queuePush(0); }
  showSyncStatus();
}

// PUT sends everything; the server merges and returns the combined result.
async function push({ keepalive = false } = {}) {
  if (sync.mode === "locked") return;
  if (sync.inFlight) { sync.again = true; return; }
  clearTimeout(sync.pushTimer);
  sync.pushTimer = null;
  sync.inFlight = true;
  showSyncStatus();
  try { applyServer(await api("PUT", { data: state }, { keepalive })); }
  catch (error) { handleSyncError(error); }
  finally { finishRequest(); }
}

async function pull() {
  if (sync.mode === "locked" || sync.inFlight || sync.pushTimer) return;
  sync.inFlight = true;
  try {
    const result = await api("GET");
    applyServer(result);
    // This device has something the server doesn't (e.g. offline edits): send it.
    if (fingerprint(state) !== fingerprint(result.data)) sync.again = true;
  } catch (error) { handleSyncError(error); }
  finally { finishRequest(); }
}

function applyServer(result) {
  const before = fingerprint(state);
  state = mergeStates(state, result.data);
  sync.mode = "online";
  sync.retryDelay = 0;
  clearTimeout(sync.retryTimer);
  saveLocal();
  if (fingerprint(state) !== before) renderAfterRemoteChange();
}

function handleSyncError(error) {
  const kind = error?.kind || "failed";
  if (kind === "locked") { sync.mode = "locked"; showLock(); return; }
  sync.mode = kind === "unavailable" ? "local" : "offline";
  sync.retryDelay = Math.min(60000, sync.retryDelay ? sync.retryDelay * 2 : 3000);
  clearTimeout(sync.retryTimer);
  sync.retryTimer = setTimeout(() => push(), kind === "unavailable" ? 60000 : sync.retryDelay);
}

// --------------------------------------------------------------- lock UI

function showLock() {
  const lock = $("#lock-screen");
  showSyncStatus();
  if (!lock.hidden) return;
  lock.hidden = false;
  $("#app-shell").inert = true;
  $("#lock-error").hidden = true;
  setTimeout(() => $("#lock-input").focus(), 60);
}
function hideLock() {
  $("#lock-screen").hidden = true;
  $("#app-shell").inert = false;
  $("#lock-input").value = "";
}
$("#lock-form").addEventListener("submit", async event => {
  event.preventDefault();
  const input = $("#lock-input");
  const error = $("#lock-error");
  const button = $("#lock-submit");
  const passphrase = input.value.trim();
  if (!passphrase) { input.focus(); return; }
  button.disabled = true;
  button.textContent = "Checking…";
  error.hidden = true;
  try {
    const response = await fetch("/api/unlock", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase }),
    });
    if (response.ok) {
      hideLock();
      sync.mode = "connecting";
      push();
      return;
    }
    error.textContent = response.status === 401 ? "That passphrase isn't right."
      : response.status === 503 ? "The server isn't set up yet (missing environment variables)."
      : "Something went wrong. Try again.";
  } catch {
    error.textContent = "Couldn't reach the server. Check your connection.";
  } finally {
    button.disabled = false;
    button.textContent = "Unlock";
  }
  error.hidden = false;
  input.select();
});

// ------------------------------------------------------------- deadlines

const expandedIds = new Set();
let armedId = null;
let needsResort = false;
let resortTimer = null;
let pendingDeadlineRender = false;
let suppressClickUntil = 0;
let renderedDay = getToday().getTime();

function sortKey(deadline) {
  return `${deadline.date || ""}T${deadline.category === "reminder" && deadline.time ? deadline.time : ""}`;
}
function subtitle(deadline) {
  if (deadline.category === "reminder") return deadline.time ? `Reminder · ${formatTime(deadline.time)}` : "Reminder";
  return deadline.institution || "Personal";
}
function itemElement(id) { return $(`.deadline-item[data-id="${CSS.escape(id)}"]`); }
function updateDeadlineCount() { $("#deadline-count").textContent = `${state.deadlines.filter(d => !d.complete).length} open`; }
function setCountdown(element, deadline) {
  const days = daysAway(deadline.date);
  element.textContent = countdownText(days);
  element.title = spokenCountdown(days);
  element.className = `countdown ${deadline.complete ? "" : urgencyClass(days)}`.trim();
}

// Show or hide the fields that only make sense for reminders / other types.
function applyCategoryFields(container, category) {
  const isReminder = category === "reminder";
  for (const field of $$("[data-only]", container)) field.hidden = (field.dataset.only === "reminder") !== isReminder;
}

// Don't yank an open edit form out from under you when a sync arrives.
function requestDeadlineRender() {
  if ($("#deadline-list .reminder-edit-form, #deadline-list .delete-confirm")) { pendingDeadlineRender = true; return; }
  renderDeadlines();
}

function renderDeadlines() {
  pendingDeadlineRender = false;
  renderedDay = getToday().getTime();
  updateDeadlineCount();
  const list = $("#deadline-list");
  list.replaceChildren();
  const sorted = [...state.deadlines].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  if (!sorted.length) {
    list.append(el("div", "empty-list", "No deadlines yet. Add one when you are ready."));
    armedId = null;
    return;
  }
  let previousGroup = "";
  for (const deadline of sorted.filter(d => !d.complete)) {
    const group = dateGroup(deadline.date);
    if (group !== previousGroup) { list.append(el("div", "date-group-label", group)); previousGroup = group; }
    list.append(buildDeadline(deadline));
  }
  const completed = sorted.filter(d => d.complete);
  if (completed.length) {
    list.append(el("div", "date-group-label", `Completed · ${completed.length}`));
    for (const deadline of completed) list.append(buildDeadline(deadline));
  }
  const armed = armedId && itemElement(armedId);
  if (armed) armed.classList.add("is-armed");
  else armedId = null;
}

function buildDeadline(deadline) {
  const id = deadline.id;
  const fragment = $("#deadline-template").content.cloneNode(true);
  const item = $(".deadline-item", fragment);
  const row = $(".deadline-row", fragment);
  const details = $(".deadline-details", fragment);

  item.dataset.id = id;
  item.classList.toggle("is-complete", Boolean(deadline.complete));
  const date = $(".deadline-date", fragment);
  date.textContent = formatDate(deadline.date);
  date.dateTime = deadline.date || "";
  $(".deadline-main strong", fragment).textContent = deadline.title || "Untitled";
  $(".deadline-main small", fragment).textContent = subtitle(deadline);
  const type = $(".deadline-type", fragment);
  type.textContent = categoryLabel(deadline.category);
  if (labels[deadline.category]) type.classList.add(deadline.category);
  setCountdown($(".countdown", fragment), deadline);

  renderDeadlineDetails(details, id);
  if (expandedIds.has(id)) { details.hidden = false; item.classList.add("expanded"); }
  row.setAttribute("aria-expanded", String(!details.hidden));

  row.addEventListener("click", event => {
    if (performance.now() < suppressClickUntil || event.target.closest(".completion")) return;
    const open = details.hidden;
    details.hidden = !open;
    item.classList.toggle("expanded", open);
    row.setAttribute("aria-expanded", String(open));
    if (open) expandedIds.add(id); else expandedIds.delete(id);
  });
  $(".completion", fragment).addEventListener("click", event => {
    event.stopPropagation();
    if (performance.now() >= suppressClickUntil) toggleComplete(id);
  });
  $(".swipe-delete", fragment).addEventListener("click", () => deleteDeadline(id));
  $(".row-delete", fragment).addEventListener("click", () => deleteDeadline(id));
  attachSwipe($(".deadline-slide", fragment), item);
  return fragment;
}

function renderDeadlineDetails(details, id) {
  const deadline = findDeadline(id);
  if (!deadline) return;
  details.replaceChildren();
  const header = el("div", "detail-header");
  const edit = el("button", "edit-reminder", "Edit");
  edit.type = "button";
  header.append(edit);
  details.append(header);
  const section = (label, content) => details.append(el("span", "detail-label", label), content);
  const text = value => el("div", "detail-text", value);

  if (deadline.category === "reminder") {
    if (deadline.time) section("Time", text(formatTime(deadline.time)));
    section("Notes", text(deadline.notes || "No notes yet."));
  } else {
    section("Details", text(deadline.details || "No extra details yet."));
    const href = cleanLink(deadline.link);
    let link;
    if (href) {
      link = el("a", "details-link", "Open resource ↗");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    } else {
      link = el("div", "detail-text", "No link added");
    }
    section("Link", link);
    section("Notes", text(deadline.notes || "No notes yet."));
  }
  edit.addEventListener("click", event => { event.stopPropagation(); renderDeadlineEditor(details, id); });
}

function renderDeadlineEditor(details, id) {
  const deadline = findDeadline(id);
  if (!deadline) return;
  const options = Object.entries(labels)
    .map(([value, label]) => `<option value="${value}" ${deadline.category === value ? "selected" : ""}>${label}</option>`)
    .join("");
  details.innerHTML = `<form class="reminder-edit-form">
    <label>Title<input name="title" value="${escapeAttr(deadline.title)}" required></label>
    <label>Date<input name="date" type="date" value="${escapeAttr(deadline.date)}" required></label>
    <label data-only="standard">Institution<input name="institution" value="${escapeAttr(deadline.institution)}"></label>
    <label data-only="reminder">Time <em>(optional)</em><input name="time" type="time" value="${escapeAttr(deadline.time)}"></label>
    <label>Type<select name="category">${options}</select></label>
    <label class="wide" data-only="standard">Details<textarea name="details">${escapeAttr(deadline.details)}</textarea></label>
    <label class="wide" data-only="standard">Link<input name="link" type="url" inputmode="url" autocapitalize="off" value="${escapeAttr(deadline.link)}" placeholder="https://"></label>
    <label class="wide">Notes<textarea name="notes">${escapeAttr(deadline.notes)}</textarea></label>
    <div class="reminder-form-actions"><button class="danger-button" type="button" data-action="delete">Delete</button><button class="text-button" type="button" data-action="cancel">Cancel</button><button class="primary-button" type="submit">Save changes</button></div>
  </form>`;
  const form = $("form", details);
  const category = $('[name="category"]', form);
  applyCategoryFields(form, category.value);
  category.addEventListener("change", () => applyCategoryFields(form, category.value));
  $('[data-action="cancel"]', form).addEventListener("click", () => {
    renderDeadlineDetails(details, id);
    if (pendingDeadlineRender) renderDeadlines();
  });
  $('[data-action="delete"]', form).addEventListener("click", () => renderDeadlineDeleteConfirm(details, id));
  form.addEventListener("submit", event => {
    event.preventDefault();
    const values = new FormData(form);
    const read = key => String(values.get(key) || "").trim();
    if (!read("title") || !read("date")) return;
    let current = findDeadline(id);
    if (!current) { current = { id, complete: false }; state.deadlines.push(current); }
    Object.assign(current, {
      title: read("title"),
      date: read("date"),
      institution: read("institution"),
      category: labels[read("category")] ? read("category") : "registration",
      time: read("time"),
      details: read("details"),
      link: cleanLink(read("link")),
      notes: read("notes"),
      updatedAt: nowISO(),
    });
    changed();
    renderDeadlines();
  });
}

function renderDeadlineDeleteConfirm(details, id) {
  const deadline = findDeadline(id);
  if (!deadline) return;
  details.replaceChildren();
  const box = el("div", "delete-confirm");
  const message = el("p", null, `This will permanently remove “${deadline.title}”.`);
  const actions = el("div", "reminder-form-actions");
  const keep = el("button", "text-button", "Keep it");
  const confirm = el("button", "primary-button delete-confirm-button", "Delete");
  keep.type = confirm.type = "button";
  actions.append(keep, confirm);
  box.append(el("span", "detail-label", "Delete deadline?"), message, actions);
  details.append(box);
  keep.addEventListener("click", () => renderDeadlineEditor(details, id));
  confirm.addEventListener("click", () => {
    state.deadlines = state.deadlines.filter(item => item.id !== id);
    markDeleted(id);
    expandedIds.delete(id);
    changed();
    renderDeadlines();
  });
}

function arm(item) {
  if (armedId && armedId !== item.dataset.id) disarm();
  armedId = item.dataset.id;
  item.classList.add("is-armed");
}
function disarm() {
  if (!armedId) return;
  itemElement(armedId)?.classList.remove("is-armed");
  armedId = null;
  if (needsResort) scheduleResort();
}
// Completed items move to the bottom, but only after you've moved on, so the
// delete button that slides in after ticking something still works.
function scheduleResort() {
  clearTimeout(resortTimer);
  resortTimer = setTimeout(() => {
    if (armedId) return;
    needsResort = false;
    requestDeadlineRender();
  }, 320);
}

function toggleComplete(id) {
  const deadline = findDeadline(id);
  if (!deadline) return;
  const item = itemElement(id);
  disarm();
  deadline.complete = !deadline.complete;
  deadline.updatedAt = nowISO();
  changed();
  updateDeadlineCount();
  if (item) {
    item.classList.toggle("is-complete", deadline.complete);
    setCountdown($(".countdown", item), deadline);
  }
  needsResort = true;
  if (deadline.complete && item) arm(item);
  else scheduleResort();
}

function deleteDeadline(id) {
  const item = itemElement(id);
  if (armedId === id) armedId = null;
  state.deadlines = state.deadlines.filter(d => d.id !== id);
  markDeleted(id);
  expandedIds.delete(id);
  changed();
  updateDeadlineCount();
  if (!item) { requestDeadlineRender(); return; }
  item.style.height = `${item.offsetHeight}px`;
  item.classList.add("is-removing");
  item.getBoundingClientRect();
  item.style.height = "0px";
  setTimeout(requestDeadlineRender, 240);
}

// Swipe left on a row (touch / pen) to reveal Delete.
function attachSwipe(slide, item) {
  let gesture = null;
  const swipeWidth = () => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--swipe-width")) || 56;
  slide.addEventListener("pointerdown", event => {
    if (event.pointerType === "mouse" || !event.isPrimary) return;
    gesture = { x: event.clientX, y: event.clientY, id: event.pointerId, swiping: false, dx: 0 };
  });
  slide.addEventListener("pointermove", event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.swiping) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { gesture = null; return; }
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
      gesture.swiping = true;
      try { slide.setPointerCapture(event.pointerId); } catch {}
      slide.style.transition = "none";
    }
    gesture.dx = dx;
    const width = swipeWidth();
    slide.style.transform = `translateX(${Math.max(-width * 1.35, Math.min(0, dx))}px)`;
  });
  const finish = event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const { swiping, dx } = gesture;
    gesture = null;
    if (!swiping) return;
    slide.style.transition = "";
    slide.style.transform = "";
    suppressClickUntil = performance.now() + 400;
    if (dx < -swipeWidth() / 2) arm(item);
  };
  slide.addEventListener("pointerup", finish);
  slide.addEventListener("pointercancel", finish);
}

function refreshCountdowns() {
  setTodayLabel();
  // New day: date groups ("Today", "Tomorrow", …) shift, so rebuild properly.
  if (getToday().getTime() !== renderedDay) { requestDeadlineRender(); return; }
  for (const item of $$(".deadline-item")) {
    const deadline = findDeadline(item.dataset.id);
    const countdown = $(".countdown", item);
    if (deadline && countdown) setCountdown(countdown, deadline);
  }
}

// ----------------------------------------------------------- add-deadline

const addFields = ["title", "date", "institution", "time", "details", "link", "notes"];
function openAddForm() {
  if (tabletQuery.matches) setView("deadlines");
  const form = $("#deadline-form");
  form.hidden = false;
  $("#sheet-backdrop").hidden = false;
  $("#deadline-form-error").hidden = true;
  $("#show-deadline-form").setAttribute("aria-expanded", "true");
  applyCategoryFields(form, $("#new-deadline-category").value);
  $("#new-deadline-title").focus();
}
function closeAddForm() {
  $("#deadline-form").hidden = true;
  $("#sheet-backdrop").hidden = true;
  $("#show-deadline-form").setAttribute("aria-expanded", "false");
}
function addDeadline() {
  const value = name => $(`#new-deadline-${name}`).value.trim();
  const error = $("#deadline-form-error");
  if (!value("title") || !value("date")) {
    error.textContent = !value("title") ? "Give it a title." : "Pick a date.";
    error.hidden = false;
    $(`#new-deadline-${value("title") ? "date" : "title"}`).focus();
    return;
  }
  const category = $("#new-deadline-category").value;
  state.deadlines.push({
    id: uid(),
    title: value("title"),
    date: value("date"),
    category: labels[category] ? category : "registration",
    institution: value("institution"),
    time: value("time"),
    details: value("details"),
    link: cleanLink(value("link")),
    notes: value("notes"),
    complete: false,
    updatedAt: nowISO(),
  });
  changed();
  renderDeadlines();
  closeAddForm();
  for (const name of addFields) $(`#new-deadline-${name}`).value = "";
}

// ------------------------------------------------------------------ notes

let pendingEditorRender = false;

function editorFocused() {
  const active = document.activeElement;
  return Boolean(active) && Boolean(active.closest?.("#editor-content")) && active.id !== "note-back";
}

function buildNoteRow(note) {
  const row = el("button", "note-row");
  row.type = "button";
  row.dataset.id = note.id;
  row.classList.toggle("active", note.id === selectedNoteId);
  row.append(el("strong", null, note.title || "Untitled note"), el("small", null, notePreview(note)));
  row.addEventListener("click", () => selectNote(note.id));
  return row;
}
function renderNoteList() {
  $("#note-rows").replaceChildren(...sortedNotes().map(buildNoteRow));
}
// While typing, only touch the one row that changed.
function updateNoteRow(note) {
  const rows = $("#note-rows");
  const row = $(`.note-row[data-id="${CSS.escape(note.id)}"]`, rows);
  if (!row) { renderNoteList(); return; }
  $("strong", row).textContent = note.title || "Untitled note";
  $("small", row).textContent = notePreview(note);
  if (rows.firstElementChild !== row) rows.prepend(row);
}

function renderEditor() {
  pendingEditorRender = false;
  const note = findNote(selectedNoteId);
  $("#editor-empty").hidden = Boolean(note);
  $("#editor-content").hidden = !note;
  const title = $("#note-title");
  const body = $("#note-body");
  if (!note) {
    title.value = "";
    body.replaceChildren();
    $("#note-date").textContent = "";
    setNotesMode("list");
    return;
  }
  if (title.value !== (note.title || "")) title.value = note.title || "";
  const html = toEditorHtml(note.body);
  if (body.innerHTML !== html) body.innerHTML = html;
  $("#note-date").textContent = `Edited ${formatUpdated(note.updatedAt)}`;
  resetDeleteNoteButton();
}

function selectNote(id) {
  selectedNoteId = id;
  writeLocal(SELECTED_NOTE_KEY, id);
  for (const row of $$(".note-row")) row.classList.toggle("active", row.dataset.id === id);
  renderEditor();
  setNotesMode("editor");
}

function createNote(title) {
  const note = { id: uid(), title, body: "", updatedAt: nowISO() };
  state.notes.push(note);
  changed();
  renderNoteList();
  selectNote(note.id);
  $("#note-body").focus();
}

function updateActiveNote(property, value) {
  const note = findNote(selectedNoteId);
  if (!note) return;
  note[property] = value;
  note.updatedAt = nowISO();
  changed(900);
  updateNoteRow(note);
  $("#note-date").textContent = "Edited just now";
}
function saveNoteBody() { updateActiveNote("body", sanitizeNoteHtml($("#note-body").innerHTML)); }

let deleteNoteTimer = null;
function resetDeleteNoteButton() {
  clearTimeout(deleteNoteTimer);
  const button = $("#delete-note");
  button.textContent = "Delete";
  button.classList.remove("is-confirming");
}
// Two taps to delete, so a stray tap on a phone can't nuke a note.
function deleteActiveNote() {
  const id = selectedNoteId;
  if (!id) return;
  const button = $("#delete-note");
  if (!button.classList.contains("is-confirming")) {
    button.textContent = "Tap again to delete";
    button.classList.add("is-confirming");
    deleteNoteTimer = setTimeout(resetDeleteNoteButton, 3000);
    return;
  }
  resetDeleteNoteButton();
  state.notes = state.notes.filter(note => note.id !== id);
  markDeleted(id);
  changed();
  selectedNoteId = phoneQuery.matches ? null : sortedNotes()[0]?.id || null;
  writeLocal(SELECTED_NOTE_KEY, selectedNoteId);
  renderNoteList();
  renderEditor();
}

function toggleList(checklist) {
  const editor = $("#note-body");
  editor.focus();
  document.execCommand("insertUnorderedList");
  if (checklist) {
    const anchor = window.getSelection()?.anchorNode;
    const anchorElement = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
    const list = anchorElement?.closest("ul");
    if (list && editor.contains(list)) list.classList.toggle("checklist");
  }
  saveNoteBody();
}

function renderAfterRemoteChange() {
  requestDeadlineRender();
  renderNoteList();
  // Never replace the note you're typing in; catch up once you leave it.
  if (editorFocused()) pendingEditorRender = true;
  else renderEditor();
}

// ------------------------------------------------------------ layout/views

function setView(view) {
  const workspace = $("#workspace");
  workspace.dataset.view = view;
  writeLocal(VIEW_KEY, view);
  for (const tab of $$(".tab")) tab.setAttribute("aria-pressed", String(tab.dataset.view === view));
}
function setNotesMode(mode) {
  $("#notes-panel").dataset.mode = mode;
}
function setNotesHidden(hidden) {
  const workspace = $("#workspace");
  const notesPanel = $("#notes-panel");
  const toggle = $("#toggle-notes");
  workspace.classList.toggle("notes-hidden", hidden);
  toggle.textContent = hidden ? "▣" : "◧";
  toggle.setAttribute("aria-label", hidden ? "Show notes" : "Hide notes");
  toggle.setAttribute("title", hidden ? "Show notes" : "Hide notes");
  notesPanel.inert = hidden;
  notesPanel.setAttribute("aria-hidden", String(hidden));
}

// On phones, size the app to the *visible* area so the keyboard never covers it.
function syncViewport() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  if (!viewport || !tabletQuery.matches) {
    root.style.removeProperty("--app-height");
    root.style.removeProperty("--app-offset");
    return;
  }
  root.style.setProperty("--app-height", `${Math.round(viewport.height)}px`);
  root.style.setProperty("--app-offset", `${Math.round(viewport.offsetTop)}px`);
}
function updateKeyboardState() {
  const active = document.activeElement;
  const typing = coarsePointer.matches && active?.matches?.('input:not([type="date"]):not([type="time"]), textarea, [contenteditable="true"]');
  document.documentElement.classList.toggle("keyboard-open", Boolean(typing));
}

function applyTheme(theme) {
  const root = document.documentElement;
  const toggle = $("#toggle-theme");
  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  root.dataset.theme = theme;
  toggle.setAttribute("aria-label", label);
  toggle.setAttribute("title", label);
  $('meta[name="theme-color"]').setAttribute("content", getComputedStyle(root).getPropertyValue("--paper").trim());
}
function switchTheme() {
  const root = document.documentElement;
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  root.classList.add("theme-switching");
  applyTheme(next);
  writeLocal(THEME_KEY, next);
  getComputedStyle(root).opacity;
  requestAnimationFrame(() => root.classList.remove("theme-switching"));
}

function currentSplit() { return Number.parseFloat(getComputedStyle($("#workspace")).getPropertyValue("--tracker-width")) || 56; }
function setSplit(value) {
  const workspace = $("#workspace");
  const available = workspace.getBoundingClientRect().width;
  if (!available) return;
  const minimum = Math.max(38, (420 / available) * 100);
  const maximum = Math.min(68, 100 - (428 / available) * 100);
  const split = Math.max(minimum, Math.min(maximum, value));
  workspace.style.setProperty("--tracker-width", `${split}%`);
  $("#resize-handle").setAttribute("aria-valuenow", String(Math.round(split)));
  writeLocal(SPLIT_KEY, String(split));
}
function setSplitFromPointer(clientX) {
  const bounds = $("#workspace").getBoundingClientRect();
  setSplit(((clientX - bounds.left) / bounds.width) * 100);
}

// ---------------------------------------------------------------- events

$("#show-deadline-form").addEventListener("click", () => ($("#deadline-form").hidden ? openAddForm() : closeAddForm()));
$("#cancel-deadline").addEventListener("click", closeAddForm);
$("#sheet-backdrop").addEventListener("click", closeAddForm);
$("#deadline-form").addEventListener("submit", event => { event.preventDefault(); addDeadline(); });
$("#new-deadline-category").addEventListener("change", event => applyCategoryFields($("#deadline-form"), event.target.value));
$("#toggle-theme").addEventListener("click", switchTheme);
$("#toggle-notes").addEventListener("click", () => setNotesHidden(!$("#workspace").classList.contains("notes-hidden")));
for (const tab of $$(".tab")) tab.addEventListener("click", () => setView(tab.dataset.view));

document.addEventListener("pointerdown", event => { if (armedId && !event.target.closest(".swipe-delete")) disarm(); }, true);
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  disarm();
  if (!$("#deadline-form").hidden) closeAddForm();
});

$("#new-note-field").addEventListener("keydown", event => {
  const field = event.currentTarget;
  if (event.key !== "Enter" || event.isComposing || !field.value.trim()) return;
  event.preventDefault();
  const title = field.value.trim();
  field.value = "";
  createNote(title);
});
$("#note-back").addEventListener("click", () => {
  document.activeElement?.blur?.();
  setNotesMode("list");
});
$("#note-title").addEventListener("input", event => updateActiveNote("title", event.target.value));
$("#note-body").addEventListener("input", saveNoteBody);
$("#note-body").addEventListener("paste", event => {
  // Paste as plain text: no hidden styles or markup from other apps.
  const text = event.clipboardData?.getData("text/plain");
  if (text == null) return;
  event.preventDefault();
  document.execCommand("insertText", false, text);
});
$("#note-body").addEventListener("click", event => {
  const item = event.target.closest(".checklist li");
  if (!item || !$("#note-body").contains(item)) return;
  if (event.clientX - item.getBoundingClientRect().left > 30) return;
  event.preventDefault();
  item.classList.toggle("checked");
  saveNoteBody();
});
$("#editor-content").addEventListener("focusout", () => {
  setTimeout(() => { if (pendingEditorRender && !editorFocused()) renderEditor(); }, 0);
});
for (const [id, checklist] of [["bullet-list", false], ["checklist", true]]) {
  const button = $(`#${id}`);
  // Keep the caret in the note when tapping a format button.
  button.addEventListener("pointerdown", event => event.preventDefault());
  button.addEventListener("mousedown", event => event.preventDefault());
  button.addEventListener("click", () => toggleList(checklist));
}
$("#delete-note").addEventListener("click", deleteActiveNote);

const resizeHandle = $("#resize-handle");
resizeHandle.addEventListener("pointerdown", event => {
  if (tabletQuery.matches) return;
  resizeHandle.classList.add("is-resizing");
  resizeHandle.setPointerCapture(event.pointerId);
  setSplitFromPointer(event.clientX);
});
resizeHandle.addEventListener("pointermove", event => { if (resizeHandle.hasPointerCapture(event.pointerId)) setSplitFromPointer(event.clientX); });
resizeHandle.addEventListener("pointerup", event => {
  if (resizeHandle.hasPointerCapture(event.pointerId)) resizeHandle.releasePointerCapture(event.pointerId);
  resizeHandle.classList.remove("is-resizing");
});
resizeHandle.addEventListener("keydown", event => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  setSplit(currentSplit() + (event.key === "ArrowLeft" ? -2 : 2));
});

tabletQuery.addEventListener("change", () => {
  if (tabletQuery.matches) setNotesHidden(false);
  syncViewport();
});
window.visualViewport?.addEventListener("resize", syncViewport);
window.visualViewport?.addEventListener("scroll", syncViewport);
document.addEventListener("focusin", updateKeyboardState);
document.addEventListener("focusout", () => setTimeout(updateKeyboardState, 60));

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshCountdowns();
    pull();
  } else if (sync.pushTimer) {
    // Leaving the page with unsent edits: send them now.
    push({ keepalive: JSON.stringify(state).length < 60000 });
  }
});
window.addEventListener("online", () => push());

// ------------------------------------------------------------------ start

applyTheme(document.documentElement.dataset.theme || "light");
setTodayLabel();
setView(tabletQuery.matches ? readLocal(VIEW_KEY) || "deadlines" : "deadlines");
setNotesMode("list");
const storedSplit = Number.parseFloat(readLocal(SPLIT_KEY));
if (Number.isFinite(storedSplit) && !tabletQuery.matches) setSplit(storedSplit);
if (selectedNoteId && !findNote(selectedNoteId)) selectedNoteId = null;
syncViewport();
renderDeadlines();
renderNoteList();
renderEditor();
showSyncStatus();
pull();
setInterval(refreshCountdowns, 60000);
setInterval(() => { if (document.visibilityState === "visible" && sync.mode === "online") pull(); }, 10000);
