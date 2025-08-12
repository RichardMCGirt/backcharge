/* =========================
   CONFIG / CONSTANTS
========================= */
const AIRTABLE_API_KEY = "pat6QyOfQCQ9InhK4.4b944a38ad4c503a6edd9361b2a6c1e7f02f216ff05605f7690d3adb12c94a3c";
const BASE_ID = "appQDdkj6ydqUaUkE";
const TABLE_ID = "tblg98QfBxRd6uivq";

// Linked tables
const SUBCONTRACTOR_TABLE = "tblgsUP8po27WX7Hb";
const CUSTOMER_TABLE = "tblQ7yvLoLKZlZ9yU";
const TECH_TABLE = "tblj6Fp0rvN7QyjRv";
const BRANCH_TABLE = "tblD2gLfkTtJYIhmK";

// Cache & State
const recordCache = {};
let allRecords = []; 
let activeTechFilter = null;
let activeBranchFilter = null;
let hasRestoredFilters = false;

let pendingDecision = null;
let pendingRecordId = null;
let pendingRecordName = null;
let lastActiveCardId = null;

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

  // Build cache: recordId → displayName
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

      return jobName.includes(searchTerm) ||
             subcontractor.includes(searchTerm) ||
             customer.includes(searchTerm) ||
             technician.includes(searchTerm) ||
             branch.includes(searchTerm);
    });
  }

  container.innerHTML = "";

  records.forEach(record => {
    const fields = record.fields;

    const jobName = fields["Job Name"] || "";
    const reason = fields["Reason for Backcharge"] || "";
    let amount = fields["Backcharge Amount"] || "";
    if (amount !== "") {
      amount = `$${parseFloat(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    const branch = (fields["Vanir Branch"] || []).map(id => getCachedRecord(BRANCH_TABLE, id)).join(", ");
    const technician = (fields["Field Technician"] || []).map(id => getCachedRecord(TECH_TABLE, id)).join(", ");
    const customer = (fields["Customer"] || []).map(id => getCachedRecord(CUSTOMER_TABLE, id)).join(", ");
    const subcontractor = (fields["Subcontractor to Backcharge"] || []).map(id => getCachedRecord(SUBCONTRACTOR_TABLE, id)).join(", ");
    const photos = fields["Photos"] || [];
    const photoCount = photos.length;

    const card = document.createElement("div");
    card.className = "review-card";
    card.setAttribute("data-id", record.id);
    card.setAttribute("tabindex", "0");
    card.innerHTML = `
      <div class="swipe-hint swipe-approve"></div>
      <div class="swipe-hint swipe-dispute"></div>

      <p style="text-align:center;margin:0 0 8px 0;"><span class="job-name">${jobName}</span></p>

      <div class="chips">
        ${branch ? `<span class="chip">${branch}</span>` : ""}
        ${technician ? `<span class="chip">Techniciab: ${technician}</span>` : ""}
        ${customer ? `<span class="chip">Customer: ${customer}</span>` : ""}
        ${subcontractor ? `<span class="chip">Subcontractor: ${subcontractor}</span>` : ""}
        ${amount ? `<span class="chip">Amount: ${amount}</span>` : ""}
      </div>

      ${reason ? `<div class="kv"><b>Reason</b><div>${reason}</div></div>` : ""}

      ${photoCount > 0 ? `
        <div class="photos"><a href="#" class="photo-link" data-id="${record.id}">📷 ${photoCount} image(s)</a></div>
      ` : ""}

      <div class="decision-buttons">
        <button class="dispute" data-action="Dispute">Dispute</button>
        <button class="approve" data-action="Approve">Approve</button>
      </div>
    `;

    // Photo modal
    if (photoCount > 0) {
      const a = card.querySelector(".photo-link");
      a.addEventListener("click", (e) => {
        e.preventDefault();
        openPhotoModal(photos);
      });
    }

    // Quick actions context
    card.addEventListener("click", () => {
      lastActiveCardId = record.id;
      pendingRecordName = jobName || "Unknown Job";
    });
    card.addEventListener("focus", () => {
      lastActiveCardId = record.id;
      pendingRecordName = jobName || "Unknown Job";
    });

    // Buttons → open sheet
    card.querySelectorAll(".decision-buttons button").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-action");
        openDecisionSheet(record.id, jobName, action);
      });
    });

    // Swipe gestures
    attachSwipeHandlers(card, (dir) => {
      if (dir === "right") {
        vibrate(15);
        openDecisionSheet(record.id, jobName, "Approve");
      } else if (dir === "left") {
        vibrate(15);
        openDecisionSheet(record.id, jobName, "Dispute");
      }
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

    // prevent vertical drags from triggering swipe
    if (Math.abs(dy) > Math.abs(dx)) return;

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
  modal.onclick = (event) => {
    if (event.target === modal) modal.style.display = "none";
  };
}

/* =========================
   BOTTOM SHEET CONFIRM
========================= */
function openDecisionSheet(recordId, jobName, decision) {
  pendingRecordId = recordId;
  pendingRecordName = jobName;
  pendingDecision = decision;

  const sheet = document.getElementById("decisionSheet");
  const title = document.getElementById("decisionTitle");
  const msg = document.getElementById("decisionMessage");
  const approveBtn = document.getElementById("confirmApproveBtn");
  const disputeBtn = document.getElementById("confirmDisputeBtn");

  title.textContent = `Confirm ${decision}`;
  msg.innerHTML = `Are you sure you want to mark <strong>${jobName || "Unknown Job"}</strong> as "<strong>${decision}</strong>"?`;

  approveBtn.style.display = decision === "Approve" ? "block" : "none";
  disputeBtn.style.display = decision === "Dispute" ? "block" : "none";

  sheet.classList.add("open");
}

function closeDecisionSheet(){
  document.getElementById("decisionSheet").classList.remove("open");
  pendingDecision = null;
  pendingRecordId = null;
  pendingRecordName = null;
}

/* =========================
   PATCH TO AIRTABLE
========================= */
async function confirmDecision(decision) {
  if (!pendingRecordId || !decision) return;

  showLoading();
  try{
    const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${pendingRecordId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields: { "Approve or Dispute": decision } })
    });

    if (!res.ok) {
      const error = await res.json();
      console.error("❌ Airtable error:", error);
      alert(`Failed to update record: ${error.error?.message || JSON.stringify(error)}`);
      return;
    }

    vibrate(30);
    showToast(`${pendingRecordName || "Record"} marked as ${decision}`);
    await fetchBackcharges(); // refresh the list
  } finally{
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

  // Build tech based on (optionally) selected branch
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

  // Only restore once
  if (skipClear && !hasRestoredFilters) {
    hasRestoredFilters = true;
    restoreFilters();
  }
}

function restoreFilters() {
  const savedTech = localStorage.getItem("techFilter");
  const savedBranch = localStorage.getItem("branchFilter");

  // Branch first
  if (savedBranch) {
    const branchFilter = document.getElementById("branchFilter");
    if (branchFilter) {
      branchFilter.value = savedBranch;
      activeBranchFilter = savedBranch;
    }
  }

  // Then tech
  if (savedTech) {
    const techFilter = document.getElementById("techFilter");
    if (techFilter) {
      techFilter.value = savedTech;
      activeTechFilter = savedTech;
    }
  }

  updateTechDropdown(true); // rebuild tech dropdown respecting branch
  renderReviews();

  // Hide branch chooser if a branch is set
  const branchFilterContainer = document.getElementById("branchFilterContainer");
  if (branchFilterContainer) {
  }
}

/* =========================
   EVENT WIRING
========================= */
document.addEventListener("DOMContentLoaded", () => {
  // Bottom sheet buttons
  document.getElementById("cancelDecisionBtn").onclick = closeDecisionSheet;
  document.getElementById("confirmApproveBtn").onclick = ()=> confirmDecision("Approve");
  document.getElementById("confirmDisputeBtn").onclick = ()=> confirmDecision("Dispute");

  // Filters
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
      renderReviews();
    });
  }

  if (searchBar) {
    searchBar.addEventListener("input", () => renderReviews());
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
  } finally{
    hideLoading();
  }
})();