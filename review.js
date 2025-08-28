/* =========================
   CONFIG / CONSTANTS
========================= */
const AIRTABLE_API_KEY = "pat6QyOfQCQ9InhK4.4b944a38ad4c503a6edd9361b2a6c1e7f02f216ff05605f7690d3adb12c94a3c";
const BASE_ID = "appQDdkj6ydqUaUkE";
const TABLE_ID = "tbl1LwBCXM0DYQSJH";

// Linked tables
const SUBCONTRACTOR_TABLE = "tblgsUP8po27WX7Hb"; // “Subcontractor Company Name”
const CUSTOMER_TABLE      = "tblQ7yvLoLKZlZ9yU"; // “Client Name”
const TECH_TABLE          = "tblj6Fp0rvN7QyjRv"; // “Full Name”
const BRANCH_TABLE        = "tblD2gLfkTtJYIhmK"; // “Office Name”
const VENDOR_TABLE        = "tbl0JQXyAizkNZF5s"; // Vendor table used by "Vendor to backcharge"

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
let disputeReasonDisplay = null;   // read-only original reason
let disputeAmountInput = null;     // editable amount only (subcontractor)
let disputeSubDisplay = null;      // read-only subcontractor(s)

// NEW: Secondary Subcontractor display + amount
let disputeSub2Display = null;         // read-only secondary sub(s)
let disputeAmount2Input = null;        // editable amount for secondary sub

// NEW: Vendor (display + editable amount)
let disputeVendorDisplay = null;        // read-only vendor(s)
let disputeVendorAmountInput = null;    // editable vendor amount

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
  const el = document.getElementById("loadingOverlay");
  if (el) el.style.display = "flex";
}
function hideLoading() {
  const el = document.getElementById("loadingOverlay");
  if (el) el.style.display = "none";
}
function vibrate(ms=20){ if (navigator.vibrate) try{ navigator.vibrate(ms);}catch(e){} }

function getRecordById(id){
  return allRecords.find(r => r.id === id) || null;
}

// Simple HTML escape for safe text injection
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

// Currency helpers (format visually, parse for numeric patch)
function formatUSD(n) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
  } catch (e) {
    var fixed = (isNaN(n) || n === "" || n == null) ? "0.00" : Number(n).toFixed(2);
    return "$" + fixed.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
}
function parseCurrencyInput(str) {
  if (str == null) return null;
  var cleaned = String(str).replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "." || cleaned === "-" || cleaned === "-.") return null;
  var n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

// Pick the first existing field name on a record from candidates; else return first candidate
function pickFieldName(obj, candidates) {
  const o = obj || {};
  for (const name of candidates) {
    if (Object.prototype.hasOwnProperty.call(o, name)) return name;
  }
  return candidates[0];
}

// Normalizes field values that might be (a) array of record IDs, (b) array of strings, or (c) a single string.
// If tableId is provided, any array items that look like record IDs are resolved via getCachedRecord(tableId, id).
function normalizeNames(fieldVal, tableId = null) {
  if (Array.isArray(fieldVal)) {
    return fieldVal
      .map(v => {
        if (typeof v === "string") {
          if (tableId && /^rec[A-Za-z0-9]{14}$/.test(v)) {
            return getCachedRecord(tableId, v);
          }
          return v;
        }
        return null;
      })
      .filter(Boolean);
  }
  if (typeof fieldVal === "string") {
    return fieldVal.split(",").map(s => s.trim()).filter(Boolean);
  }
  return [];
}

// NEW: For link rendering we need id + name
function getLinkedRecords(tableId, fieldVal) {
  const arr = Array.isArray(fieldVal)
    ? fieldVal
    : (typeof fieldVal === "string" ? fieldVal.split(",").map(s => s.trim()).filter(Boolean) : []);
  return arr
    .map(v => {
      if (typeof v === "string" && /^rec[A-Za-z0-9]{14}$/.test(v)) {
        return { id: v, name: getCachedRecord(tableId, v) };
      }
      return { id: null, name: String(v) };
    })
    .filter(x => x.name);
}

// Convenience getters for your two key fields
// UPDATED: Prefer plain text "Tech name"; fallback to legacy "Field Technician"
function getTechNamesFromRecord(rec) {
  const techPlain = rec?.fields?.["Tech name"];
  if (techPlain) return normalizeNames(techPlain, null);
  return normalizeNames(rec?.fields?.["Field Technician"] ?? [], TECH_TABLE);
}
function getBranchNamesFromRecord(rec) {
  return normalizeNames(rec?.fields?.["Vanir Branch"] ?? [], BRANCH_TABLE);
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
  await fetchAllRecords(SUBCONTRACTOR_TABLE, ["Subcontractor Company Name", "Name"]);
  await fetchAllRecords(CUSTOMER_TABLE, ["Client Name", "Name"]);
  await fetchAllRecords(TECH_TABLE, ["Full Name", "Name"]);
  await fetchAllRecords(BRANCH_TABLE, ["Office Name", "Name"]); 
  // NEW: Preload vendors so we can display names + build links
  await fetchAllRecords(VENDOR_TABLE, ["Vendor Name", "Name", "Company", "Company Name"]);
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

  if (q && searchBar) {
    searchBar.value = q;
  }

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
      const techs = getTechNamesFromRecord(rec);
      return techs.includes(activeTechFilter);
    });
  }
  if (activeBranchFilter) {
    records = records.filter(rec => {
      const branches = getBranchNamesFromRecord(rec);
      return branches.includes(activeBranchFilter);
    });
  }

  // Search
  if (searchTerm) {
    records = records.filter(rec => {
      const jobName = (rec.fields["Job Name"] || "").toLowerCase();

      // FIX: Correct constant for subcontractor table
      const subcontractor = normalizeNames(rec.fields["Subcontractor to Backcharge"] || [], SUBCONTRACTOR_TABLE)
        .join(", ")
        .toLowerCase();

      // NEW: Secondary subcontractor in search (handle capitalization variants)
      const secondarySubField = pickFieldName(rec.fields, [
        "Secondary Subcontractor to backcharge",
        "Secondary Subcontractor to Backcharge",
        "Secondary Subcontractor"
      ]);
      const secondarySubcontractor = normalizeNames(rec.fields[secondarySubField] || [], SUBCONTRACTOR_TABLE)
        .join(", ")
        .toLowerCase();

      const customer = normalizeNames(rec.fields["Customer"] || [], CUSTOMER_TABLE)
        .join(", ")
        .toLowerCase();

      const technician = getTechNamesFromRecord(rec)
        .join(", ")
        .toLowerCase();

      const branch = getBranchNamesFromRecord(rec)
        .join(", ")
        .toLowerCase();

      const idNumber = (rec.fields["ID Number"] ?? "").toString().toLowerCase();

      // NEW: vendors in search
      const vendorNames = getLinkedRecords(VENDOR_TABLE, rec.fields["Vendor to backcharge"] || [])
        .map(v => v.name)
        .join(", ")
        .toLowerCase();

      return jobName.includes(searchTerm) ||
             subcontractor.includes(searchTerm) ||
             secondarySubcontractor.includes(searchTerm) ||
             customer.includes(searchTerm) ||
             technician.includes(searchTerm) ||
             branch.includes(searchTerm) ||
             idNumber.includes(searchTerm) ||
             vendorNames.includes(searchTerm);
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

    // NEW: Secondary sub amount
    const secAmtField = pickFieldName(fields, [
      "Amount to backcharge secondary sub",
      "Amount to Backcharge Secondary Sub",
      "Secondary Backcharge Amount"
    ]);
    let secondaryAmount = fields[secAmtField];
    secondaryAmount = (secondaryAmount == null || secondaryAmount === "")
      ? ""
      : `$${parseFloat(secondaryAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const idNumber = fields["ID Number"];
    const branch = getBranchNamesFromRecord(record).join(", ");
    const techNames = getTechNamesFromRecord(record);
    const technician = techNames.join(", ");
    const customer = normalizeNames(fields["Customer"] || [], CUSTOMER_TABLE).join(", ");
    const subcontractor = normalizeNames(fields["Subcontractor to Backcharge"] || [], SUBCONTRACTOR_TABLE).join(", ");

    // NEW: Secondary subcontractor display
    const secSubField = pickFieldName(fields, [
      "Secondary Subcontractor to backcharge",
      "Secondary Subcontractor to Backcharge",
      "Secondary Subcontractor"
    ]);
    const secondarySubcontractor = normalizeNames(fields[secSubField] || [], SUBCONTRACTOR_TABLE).join(", ");

    const photos = fields["Photos"] || [];
    const photoCount = photos.length;

    // NEW: Vendor(s) and vendor amount
    const vendors = getLinkedRecords(VENDOR_TABLE, fields["Vendor to backcharge"] || []);
    const vendorLinksHtml = vendors.map(v => {
      const safeName = escapeHtml(v.name);
      if (v.id) {
        const url = `https://airtable.com/${BASE_ID}/${VENDOR_TABLE}/${v.id}`;
        return `<a class="chip" href="${url}" target="_blank" rel="noopener">Vendor to backcharge: ${safeName}</a>`;
      }
      return `<span class="chip">Vendor to backcharge: ${safeName}</span>`;
    }).join(" ");

    let vendorAmount = fields["Amount to backcharge vendor"];
    vendorAmount = (vendorAmount == null || vendorAmount === "")
      ? ""
      : `$${parseFloat(vendorAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const idChip = (idNumber !== undefined && idNumber !== null) ? `<span>ID #${idNumber}</span>` : "";
    const branchChip = (branch && branch !== activeBranchFilter) ? `<span class="chip">${escapeHtml(branch)}</span>` : "";

    let techChip = "";
    if (techNames.length === 1) {
      const tech = techNames[0];
      const href = `${location.pathname}?tech=${encodeURIComponent(tech)}${activeBranchFilter ? "&branch="+encodeURIComponent(activeBranchFilter) : ""}`;
      techChip = (tech && tech !== activeTechFilter) ? `<a class="chip" href="${href}" title="Link to ${escapeHtml(tech)}">${escapeHtml(tech)}</a>` : "";
    } else if (technician && technician !== activeTechFilter) {
      techChip = `<span class="chip">${escapeHtml(technician)}</span>`;
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
  padding:0 52px;
  display:flex;
  justify-content:space-between;
  align-items:center;
">
  ${idChip}
  <span class="job-name" style="flex:1; text-align:right;">${escapeHtml(jobName)}</span>
</p>

      <br>
      <div class="chips">
        ${branchChip}
        ${techChip}
        ${customer ? `<span class="chip">Builder: ${escapeHtml(customer)}</span>` : ""}
        ${subcontractor ? `<span class="chip">Subcontractor to backcharge: ${escapeHtml(subcontractor)}</span>` : ""}
        ${amount ? `<span class="chip">Amount to backcharge (sub): ${escapeHtml(amount)}</span>` : ""}
        ${secondarySubcontractor ? `<span class="chip">Secondary subcontractor: ${escapeHtml(secondarySubcontractor)}</span>` : ""}
        ${secondaryAmount ? `<span class="chip">Secondary sub amount: ${escapeHtml(secondaryAmount)}</span>` : ""}
        ${vendorLinksHtml || ""}
        ${vendorAmount ? `<span class="chip">Vendor Backcharge amount: ${escapeHtml(vendorAmount)}</span>` : ""}
      </div>
     ${
  reason || photoCount > 0
    ? `
      <div class="reason-photo-row">
        ${reason ? `<div class="kv"><b>Issue:</b> ${escapeHtml(reason)}</div>` : ""}
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

    card.addEventListener("click", () => { 
      lastActiveCardId = record.id; 
      pendingRecordName = jobName || "Unknown Job"; 
      pendingRecordIdNumber = (idNumber !== undefined && idNumber !== null) ? idNumber : null;
    });
    card.addEventListener("focus", () => { 
      lastActiveCardId = record.id; 
      pendingRecordName = jobName || "Unknown Job"; 
      pendingRecordIdNumber = (idNumber !== undefined && idNumber !== null) ? idNumber : null;
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
  let startHeight = 0;
  let horizontalLock = false;

  const resetClasses = () => {
    el.classList.remove("swiping", "swiping-left", "swiping-right", "leaving");
  };

  el.addEventListener("touchstart", (e)=>{
    if (!e.touches || e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    deltaX = 0;
    active = true;
    horizontalLock = false;
    startHeight = el.offsetHeight;

    el.style.transition = "none";
    el.classList.add("swiping");
  }, {passive:true});

  el.addEventListener("touchmove", (e)=>{
    if (!active || !e.touches || e.touches.length !== 1) return;

    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    const dx = x - startX;
    const dy = y - startY;

    if (!horizontalLock) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)*1.2) {
        horizontalLock = true;
      } else if (Math.abs(dy) > Math.abs(dx)) {
        return;
      }
    }
    if (!horizontalLock) return;

    deltaX = dx;

    const container = el.parentElement || document.body;
    const w = Math.max(container.clientWidth, 1);
    const progress = Math.min(1, Math.abs(dx) / (w * 0.6));

    const rotate = Math.max(-10, Math.min(10, dx * 0.03));
    const scale  = 1 + (progress * 0.02);
    const opacity = 1 - (progress * 0.1);

    el.style.transform = `translateX(${dx}px) rotate(${rotate}deg) scale(${scale})`;
    el.style.opacity = String(opacity);
    el.classList.toggle("swiping-right", dx > 8);
    el.classList.toggle("swiping-left",  dx < -8);
  }, {passive:true});

  el.addEventListener("touchend", ()=>{
    if (!active) return;

    el.style.transition = "transform .18s ease, opacity .18s ease, box-shadow .18s ease";
    el.classList.remove("swiping-right", "swiping-left");

    const threshold = Math.min((el.parentElement?.clientWidth || window.innerWidth) * 0.28, 160);
    const commitRight = deltaX > threshold;
    const commitLeft  = deltaX < -threshold;

    if (commitRight || commitLeft) {
      const direction = commitRight ? 1 : -1;
      const off = (window.innerWidth || 1000) + el.offsetWidth;

      el.classList.add("leaving");
      el.style.transform = `translateX(${direction * off}px) rotate(${direction*8}deg) scale(1.02)`;
      el.style.opacity = "0.0";

      const collapse = () => {
        el.style.transition = "height .18s ease, margin .18s ease, padding .18s ease";
        el.style.height = `${startHeight}px`;
        void el.offsetHeight;
        el.style.height = "0px";
        el.style.marginTop = "0px";
        el.style.marginBottom = "0px";
        el.style.paddingTop = "0px";
        el.style.paddingBottom = "0px";

        setTimeout(() => {
          onCommit && onCommit(commitRight ? "right" : "left");
          el.style.transform = "";
          el.style.opacity = "";
          el.style.height = "";
          el.style.marginTop = "";
          el.style.marginBottom = "";
          el.style.paddingTop = "";
          el.style.paddingBottom = "";
          resetClasses();
        }, 120);
      };

      setTimeout(collapse, 180);
    } else {
      el.style.transform = "";
      el.style.opacity = "";
      setTimeout(() => resetClasses(), 180);
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
   DISPUTE FORM (read-only subcontractor + read-only reason + editable amounts)
========================= */
function openDecisionSheet(recordId, jobName, decision) {
  pendingRecordId = recordId;
  pendingRecordName = jobName;
  pendingDecision = decision;

  const rec = getRecordById(recordId);
  pendingRecordIdNumber = rec?.fields?.["ID Number"] ?? null;

  const sheet = document.getElementById("decisionSheet");
  const title = document.getElementById("decisionTitle");
  const msg = document.getElementById("decisionMessage");
  const approveBtn = document.getElementById("confirmApproveBtn");
  const disputeBtn = document.getElementById("confirmDisputeBtn");
  const backdrop = document.getElementById("sheetBackdrop");

  ensureDisputeForm(sheet);

  title.textContent = decision === "Approve" ? "Confirm Approve" : "Confirm Dispute";
  msg.innerHTML = `Are you sure you want to mark <strong>${escapeHtml(jobName || "Unknown Job")}</strong> as "<strong>${escapeHtml(decision)}</strong>"?`;

  approveBtn.style.display = decision === "Approve" ? "block" : "none";
  disputeBtn.style.display = decision === "Dispute" ? "block" : "none";

  if (decision === "Dispute") {
    disputeFormContainer.style.display = "block";

    // Prefill read-only subcontractor(s)
    const subNames = normalizeNames(rec?.fields?.["Subcontractor to Backcharge"] || [], SUBCONTRACTOR_TABLE).join(", ");
    disputeSubDisplay.textContent = subNames || "(None)";

    // NEW: Prefill read-only secondary subcontractor(s) with capitalization variants
    const secSubField = pickFieldName(rec?.fields || {}, [
      "Secondary Subcontractor to backcharge",
      "Secondary Subcontractor to Backcharge",
      "Secondary Subcontractor"
    ]);
    const sub2Names = normalizeNames(rec?.fields?.[secSubField] || [], SUBCONTRACTOR_TABLE).join(", ");
    disputeSub2Display.textContent = sub2Names || "(None)";

    // NEW: Prefill read-only vendor(s)
    const vendorNames = getLinkedRecords(VENDOR_TABLE, rec?.fields?.["Vendor to backcharge"] || [])
      .map(v => v.name)
      .join(", ");
    disputeVendorDisplay.textContent = vendorNames || "(None)";

    // Prefill read-only original reason and editable amount(s) from the record
    const originalReason = rec?.fields?.["Issue"] || "";
    const originalAmount = rec?.fields?.["Backcharge Amount"];
    const originalVendorAmount = rec?.fields?.["Amount to backcharge vendor"];

    // NEW: Secondary amount (handle capitalization variants)
    const secAmtField = pickFieldName(rec?.fields || {}, [
      "Amount to backcharge secondary sub",
      "Amount to Backcharge Secondary Sub",
      "Secondary Backcharge Amount"
    ]);
    const originalSecondaryAmount = rec?.fields?.[secAmtField];

    disputeReasonDisplay.textContent = originalReason || "(No reason on record)";

    // Subcontractor amount
    if (originalAmount == null || originalAmount === "") {
      disputeAmountInput.value = "";
    } else {
      disputeAmountInput.value = formatUSD(originalAmount);
    }

    // Secondary sub amount
    if (originalSecondaryAmount == null || originalSecondaryAmount === "") {
      disputeAmount2Input.value = "";
    } else {
      disputeAmount2Input.value = formatUSD(originalSecondaryAmount);
    }

    // Vendor amount
    if (originalVendorAmount == null || originalVendorAmount === "") {
      disputeVendorAmountInput.value = "";
    } else {
      disputeVendorAmountInput.value = formatUSD(originalVendorAmount);
    }

  } else {
    disputeFormContainer.style.display = "none";
    disputeSubDisplay.textContent = "";
    disputeSub2Display.textContent = "";     // NEW
    disputeVendorDisplay.textContent = "";   // NEW
    disputeReasonDisplay.textContent = "";
    disputeAmountInput.value = "";
    disputeAmount2Input.value = "";          // NEW
    disputeVendorAmountInput.value = "";     // NEW
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


/* =========================
   BOTTOM SHEET CONFIRM
========================= */
// Inject minimal styles once for the dispute sheet grid layout
function ensureBackchargeFormStyles() {
  if (document.getElementById("bf-styles")) return;
  const style = document.createElement("style");
  style.id = "bf-styles";
  style.textContent = `
    /* Make the container and grid span full width */
    #disputeFormContainer { width: 100%; padding: 4px 0; }
    #disputeFormContainer .bf-grid {
      display: grid;
      width: 100%;
      grid-template-columns: minmax(0, 1fr) 220px; /* who-to-backcharge | amount */
      gap: 10px 14px;
      align-items: start;
      box-sizing: border-box;
    }

    /* Force readable (dark) text inside the sheet, even if a parent sets color: white */
    #disputeFormContainer,
* {
  color: #fff !important;
}
 #disputeFormContainer *{
  color: #111 !important;
 }

    #disputeFormContainer label {
      font-weight: 600;
      align-self: center;
      font-size: 14px;
        color: #fff !important;

    }

    #disputeFormContainer .bf-amount-label {
      text-align: right;
      align-self: center;
      padding-right: 4px;
    }

    #disputeFormContainer .bf-display {
      border: 1px solid #e1e4e8;
      border-radius: 8px;
      background: #f3f4f6;
      padding: 10px;
      min-height: 40px;
      line-height: 1.4;
      word-break: break-word;
      white-space: pre-wrap;
      box-sizing: border-box;
  color: #111 !important;

    }

    #disputeFormContainer input[type="text"] {
      height: 40px;
      border: 1px solid #e1e4e8;
      border-radius: 8px;
      padding: 8px 10px;
      width: 100%;
      box-sizing: border-box;
      background: #fff;
    }
    #disputeFormContainer input::placeholder { color: #6b7280; } /* subtle gray */

    /* Reason spans full width */
    #disputeFormContainer .bf-reason label {
      grid-column: 1 / -1;
    }
    #disputeFormContainer .bf-reason .bf-display {
      grid-column: 1 / -1;
    }

    /* Optional: make amount column a bit wider on larger screens */
    @media (min-width: 560px) {
      #disputeFormContainer .bf-grid {
        grid-template-columns: minmax(0, 1fr) 260px;
      }
    }
  `;
  document.head.appendChild(style);
}


/* =========================
   DISPUTE FORM (grid-aligned: who-to-backcharge | amount)
========================= */
function ensureDisputeForm(sheet) {
  if (!disputeFormContainer) {
    ensureBackchargeFormStyles();

    disputeFormContainer = document.createElement("div");
    disputeFormContainer.id = "disputeFormContainer";
    disputeFormContainer.style.marginTop = "12px";
    disputeFormContainer.style.display = "none";

    // Build grid with aligned rows:
    // Row 1: Subcontractor | Amount (sub)
    // Row 2: Secondary Subcontractor | Amount (secondary)
    // Row 3: Vendor | Amount (vendor)
    // Row 4: Reason (full width)
    disputeFormContainer.innerHTML = `
      <div class="bf-grid">

        <!-- Row: Subcontractor -->
        <label for="disputeSubDisplay">Primary Subcontractor to backcharge</label>
        <label class="bf-amount-label" for="disputeAmountInput">Amount</label>

        <div id="disputeSubDisplay" class="bf-display" aria-live="polite"></div>
        <input id="disputeAmountInput" type="text" inputmode="decimal" placeholder="$0.00" />

        <!-- Row: Secondary Subcontractor -->
        <label for="disputeSub2Display">Secondary Subcontractor to backcharge</label>
        <label class="bf-amount-label" for="disputeAmount2Input">Amount</label>

        <div id="disputeSub2Display" class="bf-display" aria-live="polite"></div>
        <input id="disputeAmount2Input" type="text" inputmode="decimal" placeholder="$0.00" />

        <!-- Row: Vendor -->
        <label for="disputeVendorDisplay">Vendor to backcharge</label>
        <label class="bf-amount-label" for="disputeVendorAmountInput">Amount</label>

        <div id="disputeVendorDisplay" class="bf-display" aria-live="polite"></div>
        <input id="disputeVendorAmountInput" type="text" inputmode="decimal" placeholder="$0.00" />

        <!-- Row: Reason (full width) -->
        <div class="bf-reason">
          <label for="disputeReasonDisplay">Reason</label>
          <div id="disputeReasonDisplay" class="bf-display" aria-live="polite"></div>
        </div>

      </div>
    `;

    // Wire references back to your globals
    disputeSubDisplay         = disputeFormContainer.querySelector("#disputeSubDisplay");
    disputeAmountInput        = disputeFormContainer.querySelector("#disputeAmountInput");

    disputeSub2Display        = disputeFormContainer.querySelector("#disputeSub2Display");
    disputeAmount2Input       = disputeFormContainer.querySelector("#disputeAmount2Input");

    disputeVendorDisplay      = disputeFormContainer.querySelector("#disputeVendorDisplay");
    disputeVendorAmountInput  = disputeFormContainer.querySelector("#disputeVendorAmountInput");

    disputeReasonDisplay      = disputeFormContainer.querySelector("#disputeReasonDisplay");

    // Currency formatting UX
    const hookupMoney = (inp) => {
      inp.addEventListener("blur", () => {
        const n = parseCurrencyInput(inp.value);
        inp.value = (n == null) ? "" : formatUSD(n);
      });
      inp.addEventListener("focus", () => {
        const n = parseCurrencyInput(inp.value);
        inp.value = (n == null) ? "" : String(n);
        try {
          const len = inp.value.length;
          inp.setSelectionRange(len, len);
        } catch(e){}
      });
    };
    hookupMoney(disputeAmountInput);
    hookupMoney(disputeAmount2Input);
    hookupMoney(disputeVendorAmountInput);

    sheet.appendChild(disputeFormContainer);
  }
}

function openDecisionSheet(recordId, jobName, decision) {
  pendingRecordId = recordId;
  pendingRecordName = jobName;
  pendingDecision = decision;

  const rec = getRecordById(recordId);
  pendingRecordIdNumber = rec?.fields?.["ID Number"] ?? null;

  const sheet = document.getElementById("decisionSheet");
  const title = document.getElementById("decisionTitle");
  const msg = document.getElementById("decisionMessage");
  const approveBtn = document.getElementById("confirmApproveBtn");
  const disputeBtn = document.getElementById("confirmDisputeBtn");
  const backdrop = document.getElementById("sheetBackdrop");

  ensureDisputeForm(sheet);

  title.textContent = decision === "Approve" ? "Confirm Approve" : "Confirm Dispute";
  msg.innerHTML = `Are you sure you want to mark <strong>${escapeHtml(jobName || "Unknown Job")}</strong> as "<strong>${escapeHtml(decision)}</strong>"?`;

  approveBtn.style.display = decision === "Approve" ? "block" : "none";
  disputeBtn.style.display = decision === "Dispute" ? "block" : "none";

  if (decision === "Dispute") {
    disputeFormContainer.style.display = "block";

    // Prefill read-only subcontractor(s)
    const subNames = normalizeNames(rec?.fields?.["Subcontractor to Backcharge"] || [], SUBCONTRACTOR_TABLE).join(", ");
    disputeSubDisplay.textContent = subNames || "(None)";

    // NEW: Prefill read-only secondary subcontractor(s) with capitalization variants
    const secSubField = pickFieldName(rec?.fields || {}, [
      "Secondary Subcontractor to backcharge",
      "Secondary Subcontractor to Backcharge",
      "Secondary Subcontractor"
    ]);
    const sub2Names = normalizeNames(rec?.fields?.[secSubField] || [], SUBCONTRACTOR_TABLE).join(", ");
    disputeSub2Display.textContent = sub2Names || "(None)";

    // NEW: Prefill read-only vendor(s)
    const vendorNames = getLinkedRecords(VENDOR_TABLE, rec?.fields?.["Vendor to backcharge"] || [])
      .map(v => v.name)
      .join(", ");
    disputeVendorDisplay.textContent = vendorNames || "(None)";

    // Prefill read-only original reason and editable amount(s) from the record
    const originalReason = rec?.fields?.["Issue"] || "";
    const originalAmount = rec?.fields?.["Backcharge Amount"];
    const originalVendorAmount = rec?.fields?.["Amount to backcharge vendor"];

    // NEW: Secondary amount (handle capitalization variants)
    const secAmtField = pickFieldName(rec?.fields || {}, [
      "Amount to backcharge secondary sub",
      "Amount to Backcharge Secondary Sub",
      "Secondary Backcharge Amount"
    ]);
    const originalSecondaryAmount = rec?.fields?.[secAmtField];

    disputeReasonDisplay.textContent = originalReason || "(No reason on record)";

    // Subcontractor amount
    if (originalAmount == null || originalAmount === "") {
      disputeAmountInput.value = "";
    } else {
      disputeAmountInput.value = formatUSD(originalAmount);
    }

    // Secondary sub amount
    if (originalSecondaryAmount == null || originalSecondaryAmount === "") {
      disputeAmount2Input.value = "";
    } else {
      disputeAmount2Input.value = formatUSD(originalSecondaryAmount);
    }

    // Vendor amount
    if (originalVendorAmount == null || originalVendorAmount === "") {
      disputeVendorAmountInput.value = "";
    } else {
      disputeVendorAmountInput.value = formatUSD(originalVendorAmount);
    }

  } else {
    disputeFormContainer.style.display = "none";
    disputeSubDisplay.textContent = "";
    disputeSub2Display.textContent = "";     // NEW
    disputeVendorDisplay.textContent = "";   // NEW
    disputeReasonDisplay.textContent = "";
    disputeAmountInput.value = "";
    disputeAmount2Input.value = "";          // NEW
    disputeVendorAmountInput.value = "";     // NEW
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
    if (disputeSubDisplay) disputeSubDisplay.textContent = "";
    if (disputeSub2Display) disputeSub2Display.textContent = "";   // NEW
    if (disputeVendorDisplay) disputeVendorDisplay.textContent = ""; // NEW
    if (disputeReasonDisplay) disputeReasonDisplay.textContent = "";
    if (disputeAmountInput) disputeAmountInput.value = "";
    if (disputeAmount2Input) disputeAmount2Input.value = "";       // NEW
    if (disputeVendorAmountInput) disputeVendorAmountInput.value = ""; // NEW
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
async function confirmDecision(decision) {
  if (!pendingRecordId || !decision) return;

  const fieldsToPatch = { "Approve or Dispute": decision };

  if (decision === "Dispute") {
    // Amount (required; editable) - subcontractor
    const amountRaw = disputeAmountInput?.value.trim();
    if (!amountRaw) {
      alert("Please enter the Backcharge Amount (subcontractor).");
      disputeAmountInput.focus();
      return;
    }
    const parsed = parseCurrencyInput(amountRaw);
    if (parsed == null || isNaN(parsed) || parsed < 0) {
      alert("Please enter a valid positive Backcharge Amount (e.g., 1250.00).");
      disputeAmountInput.focus();
      return;
    }
    fieldsToPatch["Backcharge Amount"] = parsed;

    // NEW: Secondary sub amount (optional; patch if provided)
    const rec = getRecordById(pendingRecordId);
    const secAmtField = pickFieldName(rec?.fields || {}, [
      "Amount to backcharge secondary sub",
      "Amount to Backcharge Secondary Sub",
      "Secondary Backcharge Amount"
    ]);
    const secAmtRaw = disputeAmount2Input?.value.trim();
    if (secAmtRaw) {
      const sParsed = parseCurrencyInput(secAmtRaw);
      if (sParsed == null || isNaN(sParsed) || sParsed < 0) {
        alert("Please enter a valid positive Secondary Sub Amount (e.g., 900.00), or clear it.");
        disputeAmount2Input.focus();
        return;
      }
      fieldsToPatch[secAmtField] = sParsed;
    }

    // NEW: Vendor amount (optional; patch if provided)
    const vendorAmountRaw = disputeVendorAmountInput?.value.trim();
    if (vendorAmountRaw) {
      const vParsed = parseCurrencyInput(vendorAmountRaw);
      if (vParsed == null || isNaN(vParsed) || vParsed < 0) {
        alert("Please enter a valid positive dollar amount for vendor backcharge (e.g., 900.00), or clear it.");
        disputeVendorAmountInput.focus();
        return;
      }
      fieldsToPatch["Amount to backcharge vendor"] = vParsed;
    }
    // NOTE: Linked selections remain read-only in this sheet.
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
    branchFilter.innerHTML += `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
  });

  updateTechDropdown(true);
}

function updateTechDropdown(skipClear = false) {
  const branchFilter = document.getElementById("branchFilter");
  const selectedBranch = branchFilter?.value || "";

  const techSet = new Set();

  for (const rec of allRecords) {
    const recordBranches = getBranchNamesFromRecord(rec);
    const recordTechs = getTechNamesFromRecord(rec);
    if (!selectedBranch || recordBranches.includes(selectedBranch)) {
      recordTechs.forEach(t => techSet.add(t));
    }
  }

  const techFilter = document.getElementById("techFilter");
  techFilter.innerHTML = `<option value="">-- All Technicians --</option>`;
  [...techSet].sort().forEach(name => {
    techFilter.innerHTML = techFilter.innerHTML + `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
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
        const c = document.getElementById("branchFilterContainer");
        if (c) c.style.display = "block";
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
    applyFiltersFromURLOrStorage();
  } finally{
    hideLoading();
  }
})();
