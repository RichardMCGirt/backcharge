/* =========================
   CONFIG / CONSTANTS
========================= */
const AIRTABLE_API_KEY = "pat6QyOfQCQ9InhK4.4b944a38ad4c503a6edd9361b2a6c1e7f02f216ff05605f7690d3adb12c94a3c";
const BASE_ID = "appQDdkj6ydqUaUkE";
const TABLE_ID = "tbl1LwBCXM0DYQSJH";

// Linked tables
const SUBCONTRACTOR_TABLE = "tblgsUP8po27WX7Hb"; // “Subcontractor Company Name”
const CUSTOMER_TABLE = "tblQ7yvLoLKZlZ9yU";     // “Client Name”
const TECH_TABLE = "tblj6Fp0rvN7QyjRv";         // “Full Name”
const BRANCH_TABLE = "tblD2gLfkTtJYIhmK";       // “Office Name”

// Cache & State
const recordCache = {};            // `${tableId}_${recId}` -> displayName
const tableRecords = {};           // tableId -> full records[]
let allRecords = []; 
let activeTechFilter = null;
let activeBranchFilter = null;
let hasRestoredFilters = false;

let pendingDecision = null;
let pendingRecordId = null;
let pendingRecordName = null;
let pendingRecordIdNumber = null; // <-- store ID Number for UI + toast
let lastActiveCardId = null;

// Dispute form elements (created once, reused)
let disputeFormContainer = null;
let disputeReasonInput = null;
let disputeAmountInput = null;
let disputeSubSelect = null;

/* =========================
   UTIL / UI HELPERS
========================= */
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = "show";
  setTimeout(() => { toast.className = toast.className.replace("show", ""); }, 2000);
}
function showLoading() {
  document.getElementById("loadingOverlay").style.display = "flex";
}
function hideLoading() {
  document.getElementById("loadingOverlay").style.display = "none";
}
function vibrate(ms=20){ if (navigator.vibrate) try{ navigator.vibrate(ms);}catch(e){} }

function getRecordById(id){
  return allRecords.find(r => r.id === id) || null;
}

/* =========================
   LINKED RECORD PRELOAD
========================= */
async function fetchAllRecords(tableId, keyFields) {
  let records = [];
  let offset = null;

  do {
    let url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?pageSize=100`;
    if (offset) url += `&offset=${offset}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } });
    if (!res.ok) break;

    const data = await res.json();
    records = records.concat(data.records);
    offset = data.offset;
  } while (offset);

  // Save full records for later filters
  tableRecords[tableId] = records;

  // Build simple display cache: recordId → displayName
  for (const rec of records) {
    let displayName = rec.id;
    for (const field of keyFields) {
      if (rec.fields[field]) {
        displayName = rec.fields[field];
        break;
      }
    }
    recordCache[`${tableId}_${rec.id}`] = displayName;
  }
}

async function preloadLinkedTables() {
  await fetchAllRecords(SUBCONTRACTOR_TABLE, ["Subcontractor Company Name"]);
  await fetchAllRecords(CUSTOMER_TABLE, ["Client Name"]);
  await fetchAllRecords(TECH_TABLE, ["Full Name"]);
  await fetchAllRecords(BRANCH_TABLE, ["Office Name"]); 
}

function getCachedRecord(tableId, recordId) {
  return recordCache[`${tableId}_${recordId}`] || recordId;
}

/* =========================
   URL PARAM HELPERS (Deep-link filters)
========================= */
function getURLParams(){
  const usp = new URLSearchParams(window.location.search);
  return {
    tech: usp.get("tech") || null,
    branch: usp.get("branch") || null,
    q: usp.get("q") || null
  };
}

function setURLParams({ tech, branch, q }){
  const usp = new URLSearchParams(window.location.search);
  if (tech) usp.set("tech", tech); else usp.delete("tech");
  if (branch) usp.set("branch", branch); else usp.delete("branch");
  if (q) usp.set("q", q); else usp.delete("q");
  const newUrl = `${location.pathname}${usp.toString() ? "?" + usp.toString() : ""}`;
  history.replaceState(null, "", newUrl);
}

/* Applies filters from URL if present; falls back to localStorage */
function applyFiltersFromURLOrStorage(){
  const { tech, branch, q } = getURLParams();

  const branchFilter = document.getElementById("branchFilter");
  const techFilter = document.getElementById("techFilter");
  const searchBar = document.getElementById("searchBar");

  let appliedBranch = null;
  let appliedTech = null;

  // 1) Branch from URL (preferred)
  if (branch && branchFilter) {
    branchFilter.value = branch;
    if (branchFilter.value === branch) {
      activeBranchFilter = branch;
      localStorage.setItem("branchFilter", branch);
    }
  }
  // If no URL branch, fallback to storage
  if (!activeBranchFilter) {
    const savedBranch = localStorage.getItem("branchFilter");
    if (savedBranch && branchFilter) {
      branchFilter.value = savedBranch;
      if (branchFilter.value === savedBranch) {
        activeBranchFilter = savedBranch;
      }
    }
  }
  appliedBranch = activeBranchFilter;

  // Rebuild tech dropdown respecting branch
  updateTechDropdown(true);

  // 2) Tech from URL (preferred)
  if (tech && techFilter) {
    // If option doesn't exist yet (rare), add it so selection works
    const hasOption = Array.from(techFilter.options).some(o => o.value === tech);
    if (!hasOption) {
      const opt = document.createElement("option");
      opt.value = tech;
      opt.textContent = tech;
      techFilter.appendChild(opt);
    }
    techFilter.value = tech;
    if (techFilter.value === tech) {
      activeTechFilter = tech;
      localStorage.setItem("techFilter", tech);
    }
  }
  // Fallback to storage
  if (!activeTechFilter) {
    const savedTech = localStorage.getItem("techFilter");
    if (savedTech && techFilter) {
      techFilter.value = savedTech;
      if (techFilter.value === savedTech) {
        activeTechFilter = savedTech;
      }
    }
  }
  appliedTech = activeTechFilter;

  // 3) Search from URL
  if (q && searchBar) {
    searchBar.value = q;
  }

  // Normalize URL to what actually applied (nice-to-have)
  setURLParams({
    tech: appliedTech || "",
    branch: appliedBranch || "",
    q: (searchBar?.value || "")
  });

  renderReviews();
}

/* When filters/search change, keep the URL in sync */
function updateURLFromCurrentFilters(){
  const searchBar = document.getElementById("searchBar");
  setURLParams({
    tech: activeTechFilter || "",
    branch: activeBranchFilter || "",
    q: (searchBar?.value || "")
  });
}

/* =========================
   FETCH BACKCHARGES
========================= */
async function fetchBackcharges() {
  allRecords = [];
  let offset = null;

  do {
    let url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?pageSize=100&filterByFormula=OR({Approve or Dispute}="", NOT({Approve or Dispute}))`;
    if (offset) url += `&offset=${offset}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } });
    if (!res.ok) break;

    const data = await res.json();
    allRecords = allRecords.concat(data.records);
    offset = data.offset;
  } while (offset);

  populateFilterDropdowns();
  renderReviews();
}

/* =========================
   RENDER CARDS
========================= */
function renderReviews() {
  const container = document.getElementById("reviewContainer");
  const searchTerm = (document.getElementById("searchBar")?.value || "").toLowerCase();

  let records = [...allRecords];

  // Apply filters
  if (activeTechFilter) {
    records = records.filter(rec => {
      const techs = (rec.fields["Field Technician"] || []).map(id => getCachedRecord(TECH_TABLE, id));
      return techs.includes(activeTechFilter);
    });
  }
  if (activeBranchFilter) {
    records = records.filter(rec => {
      const branches = (rec.fields["Vanir Branch"] || []).map(id => getCachedRecord(BRANCH_TABLE, id));
      return branches.includes(activeBranchFilter);
    });
  }

  // Search
  if (searchTerm) {
    records = records.filter(rec => {
      const jobName = (rec.fields["Job Name"] || "").toLowerCase();
      const subcontractor = (rec.fields["Subcontractor to Backcharge"] || [])
        .map(id => getCachedRecord(SUBCONTRACTOR_TABLE, id)).join(", ").toLowerCase();
      const customer = (rec.fields["Customer"] || [])
        .map(id => getCachedRecord(CUSTOMER_TABLE, id)).join(", ").toLowerCase();
      const technician = (rec.fields["Field Technician"] || [])
        .map(id => getCachedRecord(TECH_TABLE, id)).join(", ").toLowerCase();
      const branch = (rec.fields["Vanir Branch"] || [])
        .map(id => getCachedRecord(BRANCH_TABLE, id)).join(", ").toLowerCase();
      const idNumber = (rec.fields["ID Number"] ?? "").toString().toLowerCase();

      return jobName.includes(searchTerm) ||
             subcontractor.includes(searchTerm) ||
             customer.includes(searchTerm) ||
             technician.includes(searchTerm) ||
             branch.includes(searchTerm) ||
             idNumber.includes(searchTerm);
    });
  }

  container.innerHTML = "";

  records.forEach(record => {
    const fields = record.fields;

    const jobName = fields["Job Name"] || "";
    const reason = fields["Issue"] || "";
    let amount = fields["Backcharge Amount"] || "";
    if (amount !== "") {
      amount = `$${parseFloat(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    const idNumber = fields["ID Number"]; // <-- autonumber to show
    const branch = (fields["Vanir Branch"] || []).map(id => getCachedRecord(BRANCH_TABLE, id)).join(", ");
    const techNames = (fields["Field Technician"] || []).map(id => getCachedRecord(TECH_TABLE, id));
    const technician = techNames.join(", ");
    const customer = (fields["Customer"] || []).map(id => getCachedRecord(CUSTOMER_TABLE, id)).join(", ");
    const subcontractor = (fields["Subcontractor to Backcharge"] || []).map(id => getCachedRecord(SUBCONTRACTOR_TABLE, id)).join(", ");
    const photos = fields["Photos"] || [];
    const photoCount = photos.length;

    const idChip = (idNumber !== undefined && idNumber !== null) ? `<span >ID #${idNumber}</span>` : "";
    const branchChip = (branch && branch !== activeBranchFilter) ? `<span class="chip">${branch}</span>` : "";

    // If exactly one tech, make chip a link that deep-links to ?tech=<name>
    let techChip = "";
    if (techNames.length === 1) {
      const tech = techNames[0];
      const href = `${location.pathname}?tech=${encodeURIComponent(tech)}${activeBranchFilter ? "&branch="+encodeURIComponent(activeBranchFilter) : ""}`;
      techChip = (tech && tech !== activeTechFilter) ? `<a class="chip" href="${href}" title="Link to ${tech}">${tech}</a>` : "";
    } else if (technician && technician !== activeTechFilter) {
      techChip = `<span class="chip">${technician}</span>`;
    }

    const card = document.createElement("div");
    card.className = "review-card";
    card.setAttribute("data-id", record.id);
    card.setAttribute("tabindex", "0");
    card.innerHTML = `
      <div class="swipe-hint swipe-approve"></div>
      <div class="swipe-hint swipe-dispute"></div>
      <br>
<p style="
  margin:0 0 8px 0;
  padding:0 52px;        /* add horizontal breathing room */
  display:flex;
  justify-content:space-between;
  align-items:center;
">
  ${idChip}
  <span class="job-name" style="flex:1; text-align:right;">${jobName}</span>
</p>

      <br>
      <div class="chips">
        ${branchChip}
        ${techChip}
        ${customer ? `<span class="chip">Builder: ${customer}</span>` : ""}
        ${subcontractor ? `<span class="chip">Subcontractor to backcharge: ${subcontractor}</span>` : ""}
        ${amount ? `<span class="chip">Amount to backcharge: ${amount}</span>` : ""}
      </div>
     ${
  reason || photoCount > 0
    ? `
      <div class="reason-photo-row">
        ${reason ? `<div class="kv"><b>Reason:</b> ${reason}</div>` : ""}
        ${
          photoCount > 0 
            ? `<div class="photos">
                 <a href="#" class="photo-link" data-id="${record.id}">
                   ${photoCount} image${photoCount > 1 ? "s" : ""}
                 </a>
               </div>` 
            : ""
        }
      </div>
    `
    : ""
}
<div class="decision-buttons">
  <button class="dispute" data-action="Dispute">Dispute</button>
  <button class="approve" data-action="Approve">Approve</button>
</div>
`;

if (photoCount > 0) {
  const a = card.querySelector(".photo-link");
  a.addEventListener("click", (e) => { 
    e.preventDefault(); 
    openPhotoModal(photos); 
  });
}


    // Keep the latest card context for bottom sheet defaults
    card.addEventListener("click", () => { 
      lastActiveCardId = record.id; 
      pendingRecordName = jobName || "Unknown Job"; 
      pendingRecordIdNumber = (idNumber !== undefined && idNumber !== null) ? idNumber : null; // <-- store ID
    });
    card.addEventListener("focus", () => { 
      lastActiveCardId = record.id; 
      pendingRecordName = jobName || "Unknown Job"; 
      pendingRecordIdNumber = (idNumber !== undefined && idNumber !== null) ? idNumber : null; // <-- store ID
    });

    card.querySelectorAll(".decision-buttons button").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-action");
        openDecisionSheet(record.id, jobName, action);
      });
    });

    attachSwipeHandlers(card, (dir) => {
      if (dir === "right") { vibrate(15); openDecisionSheet(record.id, jobName, "Approve"); }
      else if (dir === "left") { vibrate(15); openDecisionSheet(record.id, jobName, "Dispute"); }
    });

    container.appendChild(card);
  });
}

/* =========================
   SWIPE HANDLERS
========================= */
function attachSwipeHandlers(el, onCommit){
  let startX = 0, startY = 0, deltaX = 0, active = false;

  el.addEventListener("touchstart", (e)=>{
    if (!e.touches || e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    deltaX = 0;
    active = true;
    el.style.transition = "none";
  }, {passive:true});

  el.addEventListener("touchmove", (e)=>{
    if (!active || !e.touches || e.touches.length !== 1) return;
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    const dx = x - startX;
    const dy = y - startY;

    if (Math.abs(dy) > Math.abs(dx)) return; // ignore vertical drags

    deltaX = dx;
    el.style.transform = `translateX(${dx}px) rotate(${dx*0.02}deg)`;
    el.classList.toggle("swiping-right", dx > 12);
    el.classList.toggle("swiping-left", dx < -12);
  }, {passive:true});

  el.addEventListener("touchend", ()=>{
    if (!active) return;
    el.style.transition = "transform .15s ease";
    el.classList.remove("swiping-right", "swiping-left");

    const threshold = 80; // px
    if (deltaX > threshold) {
      el.style.transform = "translateX(120vw)";
      setTimeout(()=>{ el.style.transform = ""; }, 250);
      onCommit && onCommit("right");
    } else if (deltaX < -threshold) {
      el.style.transform = "translateX(-120vw)";
      setTimeout(()=>{ el.style.transform = ""; }, 250);
      onCommit && onCommit("left");
    } else {
      el.style.transform = ""; // snap back
    }

    active = false;
    deltaX = 0;
  });
}

/* =========================
   PHOTO MODAL
========================= */
function openPhotoModal(photos) {
  const modal = document.getElementById("photoModal");
  const gallery = document.getElementById("photoGallery");
  const closeBtn = modal.querySelector(".close");

  gallery.innerHTML = "";
  photos.forEach(p => {
    const img = document.createElement("img");
    img.src = p.url;
    img.alt = "Field Photo";
    img.classList.add("modal-photo");
    gallery.appendChild(img);
  });

  modal.style.display = "flex";
  closeBtn.onclick = () => modal.style.display = "none";
  modal.onclick = (event) => { if (event.target === modal) modal.style.display = "none"; };
}

/* =========================
   DISPUTE FORM (adds Subcontractor dropdown)
========================= */
function ensureDisputeForm(sheet) {
  if (!disputeFormContainer) {
    disputeFormContainer = document.createElement("div");
    disputeFormContainer.id = "disputeFormContainer";
    disputeFormContainer.style.marginTop = "12px";
    disputeFormContainer.style.display = "none";

    // Subcontractor select (REQUIRED for Dispute)
    const subLabel = document.createElement("label");
    subLabel.setAttribute("for", "disputeSubSelect");
    subLabel.textContent = "Subcontractor to backcharge (required)";

    disputeSubSelect = document.createElement("select");
    disputeSubSelect.id = "disputeSubSelect";
    disputeSubSelect.style.width = "100%";
    disputeSubSelect.style.boxSizing = "border-box";
    disputeSubSelect.required = true;

    // Reason textarea
    const reasonLabel = document.createElement("label");
    reasonLabel.setAttribute("for", "disputeReasonInput");
    reasonLabel.textContent = "Reason for dispute (required)";

    disputeReasonInput = document.createElement("textarea");
    disputeReasonInput.id = "disputeReasonInput";
    disputeReasonInput.placeholder = "Enter the reason…";
    disputeReasonInput.rows = 3;
    disputeReasonInput.style.width = "100%";
    disputeReasonInput.style.boxSizing = "border-box";
    disputeReasonInput.style.margin = "6px 0 10px 0";

    // Amount input
    const amountLabel = document.createElement("label");
    amountLabel.setAttribute("for", "disputeAmountInput");
    amountLabel.textContent = "Backcharge Amount (required)";

    disputeAmountInput = document.createElement("input");
    disputeAmountInput.id = "disputeAmountInput";
    disputeAmountInput.type = "text";
    disputeAmountInput.inputMode = "decimal";
    disputeAmountInput.placeholder = "$0.00";
    disputeAmountInput.style.width = "100%";
    disputeAmountInput.style.boxSizing = "border-box";
    disputeAmountInput.addEventListener("input", () => {
      disputeAmountInput.value = disputeAmountInput.value.replace(/[^\d.]/g, "");
    });

    disputeFormContainer.appendChild(subLabel);
    disputeFormContainer.appendChild(disputeSubSelect);
    disputeFormContainer.appendChild(reasonLabel);
    disputeFormContainer.appendChild(disputeReasonInput);
    disputeFormContainer.appendChild(amountLabel);
    disputeFormContainer.appendChild(disputeAmountInput);

    sheet.appendChild(disputeFormContainer);
  }
}

// Build subcontractor options filtered by the record's Vanir Branch
function populateSubcontractorOptionsForRecord(record){
  // Get branch names on the current record
  const recordBranchNames = (record.fields["Vanir Branch"] || [])
    .map(id => getCachedRecord(BRANCH_TABLE, id));

  const subs = (tableRecords[SUBCONTRACTOR_TABLE] || []);
  const options = [];

  // Helper: get sub's branch names (assuming linked field "Vanir Branch" on the sub table)
  function getSubBranchNames(sub){
    const ids = sub.fields["Vanir Branch"] || [];
    return Array.isArray(ids) ? ids.map(id => getCachedRecord(BRANCH_TABLE, id)) : [];
  }

  // Build filtered list
  subs.forEach(sub => {
    const name = sub.fields["Subcontractor Company Name"];
    if (!name) return;

    const subBranchNames = getSubBranchNames(sub);
    const intersects = recordBranchNames.length === 0
      ? true // if record has no branch, show all
      : subBranchNames.some(b => recordBranchNames.includes(b));

    if (intersects) {
      options.push({ id: sub.id, name });
    }
  });

  // Fallback: if no matches, show all subs
  if (options.length === 0) {
    subs.forEach(sub => {
      const name = sub.fields["Subcontractor Company Name"];
      if (name) options.push({ id: sub.id, name });
    });
  }

  // Sort A→Z
  options.sort((a,b)=> a.name.localeCompare(b.name));

  // Fill the select
  disputeSubSelect.innerHTML = `<option value="">-- Select subcontractor --</option>`;
  options.forEach(o => {
    const opt = document.createElement("option");
    opt.value = o.id;         // record ID (linked record needs this)
    opt.textContent = o.name; // display label
    disputeSubSelect.appendChild(opt);
  });
}

/* =========================
   BOTTOM SHEET CONFIRM
========================= */
function openDecisionSheet(recordId, jobName, decision) {
  pendingRecordId = recordId;
  pendingRecordName = jobName;
  pendingDecision = decision;

  const rec = getRecordById(recordId);
  pendingRecordIdNumber = rec?.fields?.["ID Number"] ?? null; // <-- capture ID Number for toast

  const sheet = document.getElementById("decisionSheet");
  const title = document.getElementById("decisionTitle");
  const msg = document.getElementById("decisionMessage");
  const approveBtn = document.getElementById("confirmApproveBtn");
  const disputeBtn = document.getElementById("confirmDisputeBtn");
  const backdrop = document.getElementById("sheetBackdrop");

  ensureDisputeForm(sheet);

  title.textContent = decision === "Approve" ? "Confirm Approve" : "Confirm Dispute";
  msg.innerHTML = `Are you sure you want to mark <strong>${jobName || "Unknown Job"}</strong> as "<strong>${decision}</strong>"?`;

  // Show only the relevant button
  approveBtn.style.display = decision === "Approve" ? "block" : "none";
  disputeBtn.style.display = decision === "Dispute" ? "block" : "none";

  if (decision === "Dispute") {
    populateSubcontractorOptionsForRecord(rec);
    disputeFormContainer.style.display = "block";
    disputeReasonInput.value = "";
    disputeAmountInput.value = "";
    disputeSubSelect.value = "";
  } else {
    disputeFormContainer.style.display = "none";
    disputeReasonInput.value = "";
    disputeAmountInput.value = "";
    disputeSubSelect.value = "";
  }

  approveBtn.classList.toggle("attn", decision === "Approve");
  disputeBtn.classList.toggle("attn", decision === "Dispute");

  approveBtn.textContent = "✔ Approve";
  disputeBtn.textContent = "✖ Dispute";

  sheet.classList.add("open");
  if (backdrop) backdrop.classList.add("show");

  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-labelledby", "decisionTitle");
  sheet.setAttribute("aria-describedby", "decisionMessage");
  sheet.focus();

  document.addEventListener("keydown", onSheetEsc);
}

function closeDecisionSheet(){
  const sheet = document.getElementById("decisionSheet");
  const backdrop = document.getElementById("sheetBackdrop");
  const approveBtn = document.getElementById("confirmApproveBtn");
  const disputeBtn = document.getElementById("confirmDisputeBtn");

  sheet.classList.remove("open");
  if (backdrop) backdrop.classList.remove("show");

  approveBtn.classList.remove("attn");
  disputeBtn.classList.remove("attn");

  if (disputeFormContainer) {
    disputeFormContainer.style.display = "none";
    if (disputeReasonInput) disputeReasonInput.value = "";
    if (disputeAmountInput) disputeAmountInput.value = "";
    if (disputeSubSelect) disputeSubSelect.value = "";
  }

  pendingDecision = null;
  pendingRecordId = null;
  pendingRecordName = null;
  pendingRecordIdNumber = null;

  document.removeEventListener("keydown", onSheetEsc);
}
function onSheetEsc(e){ if (e.key === "Escape") closeDecisionSheet(); }

/* =========================
   PATCH TO AIRTABLE
========================= */
// =========================
// PATCH TO AIRTABLE
// =========================
async function confirmDecision(decision) {
  if (!pendingRecordId || !decision) return;

  const fieldsToPatch = { "Approve or Dispute": decision };

  if (decision === "Dispute") {
    // Require subcontractor selection
    const selectedSubId = disputeSubSelect?.value?.trim();
    if (!selectedSubId) {
      alert("Please select the subcontractor to backcharge.");
      disputeSubSelect.focus();
      return;
    }
    fieldsToPatch["Subcontractor to Backcharge"] = [selectedSubId]; // linked record array

    // Require reason
    const reasonVal = disputeReasonInput?.value.trim();
    if (!reasonVal) {
      alert("Please enter the reason for the dispute.");
      disputeReasonInput.focus();
      return;
    }
    fieldsToPatch["Reason for dispute"] = reasonVal;

    // Require amount (numeric)
    const amountRaw = disputeAmountInput?.value.trim();
    if (!amountRaw) {
      alert("Please enter the backcharge amount.");
      disputeAmountInput.focus();
      return;
    }
    const cleaned = amountRaw.replace(/[^0-9.]/g, "");
    const parsed = parseFloat(cleaned);
    if (isNaN(parsed) || parsed < 0) {
      alert("Please enter a valid positive numeric Backcharge Amount (e.g., 1250.00).");
      disputeAmountInput.focus();
      return;
    }
    fieldsToPatch["Backcharge Amount"] = parsed;
  }

  showLoading();
  try {
    const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${pendingRecordId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields: fieldsToPatch })
    });

    if (!res.ok) {
      const error = await res.json();
      console.error("❌ Airtable error:", error);
      alert(`Failed to update record: ${error.error?.message || JSON.stringify(error)}`);
      return;
    }

    vibrate(30);

    // Success toast includes the ID Number if available
    const idFrag = (pendingRecordIdNumber !== null && pendingRecordIdNumber !== undefined) ? `ID #${pendingRecordIdNumber} – ` : "";
    showToast(`${idFrag}${pendingRecordName || "Record"} marked as ${decision}`);

    await fetchBackcharges();
  } finally {
    hideLoading();
    closeDecisionSheet();
  }
}

/* =========================
   FILTER DROPDOWNS
========================= */
function populateFilterDropdowns() {
  const branchSet = new Set();

  for (const rec of allRecords) {
    (rec.fields["Vanir Branch"] || []).forEach(id => {
      branchSet.add(getCachedRecord(BRANCH_TABLE, id));
    });
  }

  const branchFilter = document.getElementById("branchFilter");
  branchFilter.innerHTML = `<option value="">-- All Branches --</option>`;
  [...branchSet].sort().forEach(name => {
    branchFilter.innerHTML += `<option value="${name}">${name}</option>`;
  });

  updateTechDropdown(true);
}

function updateTechDropdown(skipClear = false) {
  const branchFilter = document.getElementById("branchFilter");
  const selectedBranch = branchFilter?.value || "";

  const techSet = new Set();

  for (const rec of allRecords) {
    const recordBranches = (rec.fields["Vanir Branch"] || []).map(id => getCachedRecord(BRANCH_TABLE, id));
    const recordTechs = (rec.fields["Field Technician"] || []).map(id => getCachedRecord(TECH_TABLE, id));
    if (!selectedBranch || recordBranches.includes(selectedBranch)) {
      recordTechs.forEach(t => techSet.add(t));
    }
  }

  const techFilter = document.getElementById("techFilter");
  techFilter.innerHTML = `<option value="">-- All Technicians --</option>`;
  [...techSet].sort().forEach(name => {
    techFilter.innerHTML += `<option value="${name}">${name}</option>`;
  });

  if (activeTechFilter) {
    const optionExists = Array.from(techFilter.options).some(opt => opt.value === activeTechFilter);
    if (!optionExists) {
      const opt = document.createElement("option");
      opt.value = activeTechFilter;
      opt.textContent = activeTechFilter;
      techFilter.appendChild(opt);
    }
    techFilter.value = activeTechFilter;
  }

  if (!skipClear && !techSet.has(activeTechFilter)) {
    activeTechFilter = null;
    localStorage.removeItem("techFilter");
  }

  if (skipClear && !hasRestoredFilters) {
    hasRestoredFilters = true;
    restoreFilters();
  }
}

function restoreFilters() {
  // We now prefer URL params over storage, but this function is called by updateTechDropdown(true)
  // Delegate to the new URL-aware applier (it will fallback to storage if URL empty)
  applyFiltersFromURLOrStorage();
}

/* =========================
   EVENT WIRING
========================= */
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("cancelDecisionBtn").onclick = closeDecisionSheet;
  document.getElementById("confirmApproveBtn").onclick = ()=> confirmDecision("Approve");
  document.getElementById("confirmDisputeBtn").onclick = ()=> confirmDecision("Dispute");

  const techFilter = document.getElementById("techFilter");
  const branchFilter = document.getElementById("branchFilter");
  const searchBar = document.getElementById("searchBar");

  if (techFilter) {
    techFilter.addEventListener("change", e => {
      if (e.target.value) {
        activeTechFilter = e.target.value;
        localStorage.setItem("techFilter", e.target.value);
      } else {
        activeTechFilter = null;
        localStorage.removeItem("techFilter");
      }
      updateURLFromCurrentFilters();
      renderReviews();
    });
  }

  if (branchFilter) {
    branchFilter.addEventListener("change", e => {
      if (e.target.value) {
        activeBranchFilter = e.target.value;
        localStorage.setItem("branchFilter", e.target.value);
      } else {
        activeBranchFilter = null;
        localStorage.removeItem("branchFilter");
        document.getElementById("branchFilterContainer").style.display = "block";
      }
      updateTechDropdown(); 
      updateURLFromCurrentFilters();
      renderReviews();
    });
  }

  if (searchBar) {
    searchBar.addEventListener("input", () => {
      updateURLFromCurrentFilters();
      renderReviews();
    });
  }
  const backdrop = document.getElementById("sheetBackdrop");
  if (backdrop) {
    backdrop.addEventListener("click", closeDecisionSheet);
  }
});

/* =========================
   INIT
========================= */
(async () => {
  showLoading();
  try{
    await preloadLinkedTables();
    await fetchBackcharges();
    // After data & dropdowns are ready, apply URL deep-link filters (or storage)
    applyFiltersFromURLOrStorage();
  } finally{
    hideLoading();
  }
})();
