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
  await fetchAllRecords(BRANCH_TABLE, ["Office Name"]); // adjust to actual field name in tblD2gLfkTtJYIhmK
}

function getCachedRecord(tableId, recordId) {
  return recordCache[`${tableId}_${recordId}`] || recordId;
}

// Fetch all backcharges from Airtable
async function fetchBackcharges() {
  allRecords = [];
  let offset = null;

  do {
    let url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?view=viwTHoVVR3TsPDR6k`;
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

  // Apply filter if set
  if (currentFilter.type === "tech") {
    records = records.filter(rec => {
      const techs = (rec.fields["Field Technician"] || [])
        .map(id => getCachedRecord(TECH_TABLE, id));
      return techs.includes(currentFilter.value);
    });
  }

  if (currentFilter.type === "branch") {
    records = records.filter(rec => {
      const branches = (rec.fields["Vanir Branch"] || [])
        .map(id => getCachedRecord(BRANCH_TABLE, id));
      return branches.includes(currentFilter.value);
    });
  }

  // 🔍 Apply search filter
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
      <p><strong>Job Name:</strong> ${jobName}</p>
      <p><strong>Subcontractor:</strong> ${subcontractor}</p>
      <p><strong>Customer:</strong> ${customer}</p>
      <p><strong>Technician:</strong> ${technician}</p>
      <p><strong>Branch:</strong> ${branch}</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p><strong>Amount:</strong> ${amount}</p>
      <p><strong>Photos:</strong> 
        ${photoCount > 0 ? `<a href="#" class="photo-link" data-id="${record.id}">${photoCount} image(s)</a>` : "0"}
      </p>
      <button onclick="updateDecision('${record.id}', 'Approve')">Approve</button>
      <button onclick="updateDecision('${record.id}', 'Dispute')">Dispute</button>
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
    (rec.fields["Field Technician"] || []).forEach(id => {
      techSet.add(getCachedRecord(TECH_TABLE, id));
    });
    (rec.fields["Vanir Branch"] || []).forEach(id => {
      branchSet.add(getCachedRecord(BRANCH_TABLE, id));
    });
  }

  const techFilter = document.getElementById("techFilter");
  const branchFilter = document.getElementById("branchFilter");

  techFilter.innerHTML = `<option value="">-- All Technicians --</option>`;
  branchFilter.innerHTML = `<option value="">-- All Branches --</option>`;

  [...techSet].sort().forEach(name => {
    techFilter.innerHTML += `<option value="${name}">${name}</option>`;
  });

  [...branchSet].sort().forEach(name => {
    branchFilter.innerHTML += `<option value="${name}">${name}</option>`;
  });
}

async function updateDecision(recordId, decision) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${recordId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      fields: { "Decision": decision }
    })
  });

  if (res.ok) {
    alert(`Marked as ${decision}`);
    fetchBackcharges();
  }
}

// Init
(async () => {
  await preloadLinkedTables();
  await fetchBackcharges();
  populateFilterDropdowns();
})();

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
        currentFilter = { type: "tech", value: e.target.value };
      } else {
        currentFilter = { type: null, value: null };
      }
      renderReviews();
    });
  }

  if (branchFilter) {
    branchFilter.addEventListener("change", e => {
      if (e.target.value) {
        currentFilter = { type: "branch", value: e.target.value };
      } else {
        currentFilter = { type: null, value: null };
      }
      renderReviews();
    });
  }
  const searchBar = document.getElementById("searchBar");
if (searchBar) {
  searchBar.addEventListener("input", () => {
    renderReviews();
  });
}

});

