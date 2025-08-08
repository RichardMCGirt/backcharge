const AIRTABLE_API_KEY = "pat6QyOfQCQ9InhK4.4b944a38ad4c503a6edd9361b2a6c1e7f02f216ff05605f7690d3adb12c94a3c";
const BASE_ID = "appQDdkj6ydqUaUkE";
const TABLE_ID = "tblg98QfBxRd6uivq";

// Linked tables
const SUBCONTRACTOR_TABLE = "tblgsUP8po27WX7Hb";
const CUSTOMER_TABLE = "tblQ7yvLoLKZlZ9yU";
const TECH_TABLE = "tblj6Fp0rvN7QyjRv";
const BRANCH_TABLE = "tblD2gLfkTtJYIhmK";

// Cache to avoid repeated API calls
const recordCache = {};
let allRecords = []; // store globally
let currentSort = ""; // track selected sort option
let currentFilter = { type: null, value: null }; // track filter selection
let activeTechFilter = null;
let activeBranchFilter = null;
let pendingDecision = null;
let pendingRecordId = null;
let hasRestoredFilters = false;

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

// Fetch all backcharges from Airtable
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

  renderReviews();
}


// Render cards with optional sorting
function renderReviews() {
  let records = [...allRecords];

  // Apply tech filter if set
  if (activeTechFilter) {
    records = records.filter(rec => {
      const techs = (rec.fields["Field Technician"] || [])
        .map(id => getCachedRecord(TECH_TABLE, id));
      return techs.includes(activeTechFilter);
    });
  }

  // Apply branch filter if set
  if (activeBranchFilter) {
    records = records.filter(rec => {
      const branches = (rec.fields["Vanir Branch"] || [])
        .map(id => getCachedRecord(BRANCH_TABLE, id));
      return branches.includes(activeBranchFilter);
    });
  }

  // 🔍 search logic stays same
  const searchTerm = document.getElementById("searchBar")?.value.toLowerCase() || "";
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

  const container = document.getElementById("reviewContainer");
  container.innerHTML = "";

  for (const record of records) {
    const fields = record.fields;

    let subcontractor = (fields["Subcontractor to Backcharge"] || [])
      .map(id => getCachedRecord(SUBCONTRACTOR_TABLE, id)).join(", ");

    let customer = (fields["Customer"] || [])
      .map(id => getCachedRecord(CUSTOMER_TABLE, id)).join(", ");

    let technician = (fields["Field Technician"] || [])
      .map(id => getCachedRecord(TECH_TABLE, id)).join(", ");

    let branch = (fields["Vanir Branch"] || [])
      .map(id => getCachedRecord(BRANCH_TABLE, id)).join(", ");

    const jobName = fields["Job Name"] || "";
    const reason = fields["Reason for Backcharge"] || "";
    let amount = fields["Backcharge Amount"] || "";
    if (amount !== "") {
      amount = `$${parseFloat(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    // 📷 Field Photos
    const photos = fields["Photos"] || [];
    const photoCount = photos.length;

    const div = document.createElement("div");
    div.classList.add("review-card");
    div.innerHTML = `
  <p><strong>Job Name:</strong> <span class="job-name">${jobName}</span></p>
  <p><strong>Branch:</strong> ${branch}</p>
  <p><strong>Technician:</strong> ${technician}</p>
  <p><strong>Customer:</strong> ${customer}</p>
  <p><strong>Subcontractor to backcharge:</strong> ${subcontractor}</p>
  <p><strong>Reason:</strong> ${reason}</p>
  <p><strong>Amount:</strong> ${amount}</p>
${photoCount > 0 ? `
  <p><strong>Photos:</strong> 
    <a href="#" class="photo-link" data-id="${record.id}">${photoCount} image(s)</a>
  </p>
` : ""}

<div class="decision-buttons">
  <button onclick="openDecisionModal('${record.id}', 'Approve')">Approve</button>
  <button onclick="openDecisionModal('${record.id}', 'Dispute')">Dispute</button>
</div>
`;

    container.appendChild(div);

    // Attach photo modal event
    if (photoCount > 0) {
      div.querySelector(".photo-link").addEventListener("click", e => {
        e.preventDefault();
        openPhotoModal(photos);
      });
    }
  }
}

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

  modal.style.display = "block";

  // Close handlers
  closeBtn.onclick = () => modal.style.display = "none";
  window.onclick = (event) => {
    if (event.target === modal) modal.style.display = "none";
  };
}

function populateFilterDropdowns() {
  const techSet = new Set();
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

  // ✅ Now call with skipClear = true so restoreFilters() runs after this
  updateTechDropdown(true);
}


function updateTechDropdown(skipClear = false) {
  const branchFilter = document.getElementById("branchFilter");
  const selectedBranch = branchFilter?.value || "";

  const techSet = new Set();

  for (const rec of allRecords) {
    const recordBranches = (rec.fields["Vanir Branch"] || [])
      .map(id => getCachedRecord(BRANCH_TABLE, id));
    const recordTechs = (rec.fields["Field Technician"] || [])
      .map(id => getCachedRecord(TECH_TABLE, id));

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
    techFilter.value = activeTechFilter;

    const optionExists = Array.from(techFilter.options).some(opt => opt.value === activeTechFilter);
    if (!optionExists) {
      const opt = document.createElement("option");
      opt.value = activeTechFilter;
      opt.textContent = activeTechFilter;
      techFilter.appendChild(opt);
    }

    if (!localStorage.getItem("techFilter")) {
      localStorage.setItem("techFilter", activeTechFilter);
      console.log("💾 Saved tech filter to localStorage:", activeTechFilter);
    }
  }

  if (!skipClear && !techSet.has(activeTechFilter)) {
    activeTechFilter = null;
    localStorage.removeItem("techFilter");
  }

  // ✅ Prevent infinite loop
  if (skipClear && !hasRestoredFilters) {
    hasRestoredFilters = true;
    console.log("✅ Calling restoreFilters() from updateTechDropdown()");
    restoreFilters();
  }
}

function openDecisionModal(recordId, decision) {
  pendingRecordId = recordId;
  pendingDecision = decision;

  const modal = document.getElementById("decisionModal");
  const title = document.getElementById("decisionTitle");
  const message = document.getElementById("decisionMessage");
  const confirmBtn = document.getElementById("confirmDecisionBtn");

  // Find job name for display
  const record = allRecords.find(r => r.id === recordId);
  const jobName = record?.fields["Job Name"] || "Unknown Job";

  title.textContent = `Confirm ${decision}`;
  message.innerHTML = `
    Are you sure you want to mark 
    <strong>${jobName}</strong> 
    as "<strong>${decision}</strong>"?
  `;

  // ✅ Update button text + color
  if (decision === "Approve") {
    confirmBtn.textContent = "Yes, Approve";
    confirmBtn.style.backgroundColor = "#007b5e"; // green
    confirmBtn.style.color = "#fff";
  } else if (decision === "Dispute") {
    confirmBtn.textContent = "Dispute";
    confirmBtn.style.backgroundColor = "#cc2f2f"; // red
    confirmBtn.style.color = "#fff";
  }

  modal.style.display = "block";
}
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = "show";
  setTimeout(() => {
    toast.className = toast.className.replace("show", "");
  }, 2000); // hide after 2s
}
function showLoading() {
  document.getElementById("loadingOverlay").style.display = "flex";
}

function hideLoading() {
  document.getElementById("loadingOverlay").style.display = "none";
}


// Handle modal confirm/cancel
document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("decisionModal");
  const closeBtn = modal.querySelector(".close");
  const confirmBtn = document.getElementById("confirmDecisionBtn");

  closeBtn.onclick = () => modal.style.display = "none";

 confirmBtn.onclick = async () => {
  if (!pendingRecordId || !pendingDecision) return;

  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${pendingRecordId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      fields: { "Approve or Dispute": pendingDecision }
    })
  });

  if (res.ok) {
    const record = allRecords.find(r => r.id === pendingRecordId);
    const jobName = record?.fields["Job Name"] || "Unknown Job";

    showToast(`${jobName} marked as ${pendingDecision}`);
    fetchBackcharges();
  } else {
    const error = await res.json();
    console.error("❌ Airtable error:", error);
    alert(`Failed to update record: ${error.error?.message || JSON.stringify(error)}`);
  }

  modal.style.display = "none";
  pendingDecision = null;
  pendingRecordId = null;
};

  window.onclick = (event) => {
    if (event.target === modal) modal.style.display = "none";
  };
});

// Init
(async () => {
  showLoading();
  await preloadLinkedTables();
  await fetchBackcharges();
  populateFilterDropdowns(); 
  hideLoading();
})();



function restoreFilters() {
  const savedTech = localStorage.getItem("techFilter");
  const savedBranch = localStorage.getItem("branchFilter");

  console.log("🔁 Restoring saved filters...");
  console.log("📦 Saved tech filter:", savedTech);
  console.log("📦 Saved branch filter:", savedBranch);

  // Restore branch first
  if (savedBranch) {
    const branchFilter = document.getElementById("branchFilter");
    if (branchFilter) {
      branchFilter.value = savedBranch;
      activeBranchFilter = savedBranch;
      console.log("✅ Branch filter restored to:", savedBranch);
    } else {
      console.warn("⚠️ Could not find branchFilter element.");
    }
  } else {
    console.log("ℹ️ No saved branch filter found.");
  }

  // Restore tech before updating dropdown
  if (savedTech) {
    const techFilter = document.getElementById("techFilter");
    if (techFilter) {
      techFilter.value = savedTech;
      activeTechFilter = savedTech;
      console.log("✅ Tech filter restored to:", savedTech);
    } else {
      console.warn("⚠️ Could not find techFilter element.");
    }
  } else {
    console.log("ℹ️ No saved tech filter found.");
  }

  console.log("🔄 Updating tech dropdown with restored filters...");
  updateTechDropdown(true); // 🔄 rebuild dropdown with filter already set

  console.log("📋 Rendering reviews with current filters...");
  renderReviews();
}



// Hamburger toggle
document.addEventListener("DOMContentLoaded", () => {
  const toggleBtn = document.getElementById("hamburgerToggle");
  const menu = document.getElementById("hamburgerMenu");

  if (toggleBtn && menu) {
    toggleBtn.addEventListener("click", () => {
      menu.classList.toggle("open");
    });
  }

  const techFilter = document.getElementById("techFilter");
  const branchFilter = document.getElementById("branchFilter");

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
    }
    updateTechDropdown(); // 🔥 refresh tech list
    renderReviews();
  });
}

if (searchBar) {
  searchBar.addEventListener("input", e => {
    renderReviews();
  });
}

});

