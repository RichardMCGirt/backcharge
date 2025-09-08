/* =========================
   CONFIG — fill these in
========================= */
const AIRTABLE_API_KEY = "pat6QyOfQCQ9InhK4.4b944a38ad4c503a6edd9361b2a6c1e7f02f216ff05605f7690d3adb12c94a3c";
const BASE_ID          = "appQDdkj6ydqUaUkE";
const TABLE_ID         = "tblg98QfBxRd6uivq"; // e.g., main backcharge/warranty table

// Field names in your base
const FIELD_JOB_NAME    = "Job Name";
const FIELD_GM_OUTCOME  = "GM Outcome"; // must match Airtable exactly
const FIELD_ID_NUMBER   = "ID Number";  // must match Airtable exactly

// Allowed values for GM Outcome edit control
const GM_OPTIONS = [
  "GM Approved BC from Builder",
  "GM Denied BC from Builder"
];

/* =========================
   STATE
========================= */
let allRecords = [];
const pendingSaves = new Map(); // recordId -> abortController

/* =========================
   FETCH
========================= */
async function fetchAll() {
  const out = [];
  let offset = null;

  do {
    let url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_ID)}?pageSize=100&filterByFormula={Approved or Dispute}="Dispute"`;
    if (offset) url += `&offset=${offset}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Airtable error ${res.status}: ${txt || res.statusText}`);
    }
    const data = await res.json();
    out.push(...data.records);
    offset = data.offset;
  } while (offset);

  allRecords = out.filter(r => r?.fields && (r.fields[FIELD_JOB_NAME] || r.fields[FIELD_GM_OUTCOME]));
}

/* =========================
   PATCH to Airtable (GM Outcome)
========================= */
async function patchOutcome(recordId, newValue) {
  // Cancel any in-flight save for this record
  const prev = pendingSaves.get(recordId);
  if (prev) prev.abort();

  const controller = new AbortController();
  pendingSaves.set(recordId, controller);

  try {
    const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_ID)}/${recordId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields: { [FIELD_GM_OUTCOME]: newValue } }),
      signal: controller.signal
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Airtable error ${res.status}: ${txt || res.statusText}`);
    }
    const updated = await res.json();

    // Update local cache
    const idx = allRecords.findIndex(r => r.id === recordId);
    if (idx !== -1) {
      allRecords[idx] = updated;
    }
    return { ok: true };
  } catch (err) {
    if (err.name === "AbortError") return { ok: false, aborted: true };
    return { ok: false, error: err.message || String(err) };
  } finally {
    // Clear controller if still ours
    const cur = pendingSaves.get(recordId);
    if (cur === controller) pendingSaves.delete(recordId);
  }
}

/* =========================
   RENDER
========================= */
function render() {
  const container = document.getElementById("list");
  const countsEl  = document.getElementById("counts");
  const q = (document.getElementById("searchBar").value || "").trim().toLowerCase();
  const outcomeFilter = document.getElementById("outcomeFilter").value;

  let rows = [...allRecords];

  // Filter by GM Outcome (UI filter)
  if (outcomeFilter) {
    rows = rows.filter(r => {
      const v = (r.fields[FIELD_GM_OUTCOME] ?? "").toString();
      return equalsIgnoreCase(v, outcomeFilter);
    });
  }

  // Search by Job Name
  if (q) {
    rows = rows.filter(r => (r.fields[FIELD_JOB_NAME] ?? "").toString().toLowerCase().includes(q));
  }

  // Sort by outcome rank then job name
  rows.sort((a, b) => {
    const oa = rankOutcome(a.fields[FIELD_GM_OUTCOME]);
    const ob = rankOutcome(b.fields[FIELD_GM_OUTCOME]);
    if (oa !== ob) return oa - ob;
    return (a.fields[FIELD_JOB_NAME] ?? "").toString().localeCompare((b.fields[FIELD_JOB_NAME] ?? "").toString());
  });

  container.innerHTML = "";
  let approvedCount = 0, disputedCount = 0, otherCount = 0;

  rows.forEach(rec => {
    const job = (rec.fields[FIELD_JOB_NAME] ?? "").toString();
    const outcomeRaw = (rec.fields[FIELD_GM_OUTCOME] ?? "").toString().trim();
    const normalized = normalizeOutcome(outcomeRaw);

    if (normalized === "Approved") approvedCount++;
    else if (normalized === "Dispute" || normalized === "Disputed") disputedCount++;
    else otherCount++;

    const chipClass = normalized === "Approved" ? "chip ok" :
                      (normalized === "Dispute" || normalized === "Disputed") ? "chip no" : "chip";
    const safeOutcome = outcomeRaw || "(No outcome)";
    const idNum = rec.fields[FIELD_ID_NUMBER] ?? "(No ID)";

    // Build editable select for GM Outcome
    const selectId = `sel-${rec.id}`;
    const statusId = `sts-${rec.id}`;

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3 class="job">${escapeHtml(job || "(No Job Name)")}</h3>

      <div class="row">
        <span class="${chipClass}">${escapeHtml(normalized || "(No outcome)")}</span>
        <span class="muted">ID Number: ${escapeHtml(idNum)}</span>
      </div>

      <div class="field">
        <label for="${selectId}" class="muted">GM Outcome:</label>
        <select class="select" id="${selectId}" data-id="${escapeHtml(rec.id)}">
          ${GM_OPTIONS.map(opt => `<option value="${escapeHtml(opt)}"${opt === outcomeRaw ? " selected" : ""}>${escapeHtml(opt)}</option>`).join("")}
        </select>
        <span id="${statusId}" class="status muted"></span>
      </div>
    `;

    container.appendChild(card);

    const selectEl = card.querySelector(`#${CSS.escape(selectId)}`);
    const statusEl = card.querySelector(`#${CSS.escape(statusId)}`);

    // Save on change
    selectEl.addEventListener("change", async () => {
      await handleSave(selectEl, statusEl);
      // Re-render chip to reflect normalized color
      render();
    });

    // Save on blur (off-click)
    selectEl.addEventListener("blur", async () => {
      await handleSave(selectEl, statusEl);
      render();
    });
  });

  countsEl.textContent = `Showing ${rows.length} record(s) — Approved: ${approvedCount} · Dispute/Disputed: ${disputedCount}${otherCount ? ` · Other/Blank: ${otherCount}` : ""}`;
}

async function handleSave(selectEl, statusEl) {
  const recordId = selectEl.dataset.id;
  const value = selectEl.value;

  // Optimistic status hint
  statusEl.textContent = "Saving…";
  statusEl.className = "status saving";

  const { ok, error, aborted } = await patchOutcome(recordId, value);
  if (ok) {
    statusEl.textContent = "Saved";
    statusEl.className = "status saved";
  } else if (aborted) {
    // Another save superseded this one; do nothing visible
  } else {
    statusEl.textContent = `Error: ${error || "Failed to save"}`;
    statusEl.className = "status error";
  }

  // Fade status after a moment
  setTimeout(() => {
    statusEl.textContent = "";
    statusEl.className = "status muted";
  }, 1500);
}

/* =========================
   HELPERS
========================= */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}
function equalsIgnoreCase(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}
function normalizeOutcome(val) {
  const v = (val || "").toString().trim().toLowerCase();
  if (!v) return "";
  if (v === "approved" || v === "gm approved bc from builder") return "Approved";
  if (v === "dispute" || v === "disputed" || v === "gm denied bc from builder") return "Disputed";
  return val;
}
function rankOutcome(val) {
  const v = (val || "").toString().trim().toLowerCase();
  if (v === "approved" || v === "gm approved bc from builder") return 0;
  if (v === "dispute" || v === "disputed" || v === "gm denied bc from builder") return 1;
  return 2;
}

/* =========================
   URL SYNC
========================= */
function updateUrlWithSearch(query) {
  const url = new URL(window.location);
  if (query) {
    url.searchParams.set("job", query);
  } else {
    url.searchParams.delete("job");
  }
  window.history.replaceState({}, "", url);
}

/* =========================
   BOOT
========================= */
document.addEventListener("DOMContentLoaded", async () => {
  const searchBar = document.getElementById("searchBar");
  const outcomeFilter = document.getElementById("outcomeFilter");

  // If URL has ?job=..., populate the search bar
  const params = new URLSearchParams(window.location.search);
  const jobParam = params.get("job");
  if (jobParam) {
    searchBar.value = jobParam;
  }

  searchBar.addEventListener("input", () => {
    updateUrlWithSearch(searchBar.value.trim());
    render();
  });
  outcomeFilter.addEventListener("change", render);

  try {
    await fetchAll();
    render();
  } catch (e) {
    console.error(e);
    document.getElementById("list").innerHTML =
      `<div class="card"><div class="row"><span class="chip no">Error</span><span class="muted">${escapeHtml(e.message)}</span></div></div>`;
  }
});
