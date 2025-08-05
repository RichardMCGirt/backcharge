const AIRTABLE_API_KEY = "pat6QyOfQCQ9InhK4.4b944a38ad4c503a6edd9361b2a6c1e7f02f216ff05605f7690d3adb12c94a3c";
const BASE_ID = "appQDdkj6ydqUaUkE";
const TABLE_ID = "tblg98QfBxRd6uivq";

// Linked tables
const SUBCONTRACTOR_TABLE = "tblgsUP8po27WX7Hb";
const CUSTOMER_TABLE = "tblQ7yvLoLKZlZ9yU";
const TECH_TABLE = "tblj6Fp0rvN7QyjRv";
const BRANCH_TABLE = "tblD2gLfkTtJYIhmK";

// Cache data for filtering
let branchRecords = {};
let subcontractorRecords = [];
let customerRecords = [];
let techRecords = [];

// Excluded branches
const excludedBranches = ["Test Branch", "Airtable Hail Mary Test", "AT HM Test"];

// Generic fetch helper
async function fetchAll(tableId) {
  let allRecords = [];
  let offset = null;
  do {
    let url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?pageSize=100`;
    if (offset) url += `&offset=${offset}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } });
    const data = await res.json();
    allRecords = allRecords.concat(data.records);
    offset = data.offset;
  } while (offset);
  return allRecords;
}

// Populate a datalist with sorted values
function populateDatalistFromArray(records, fieldName, datalistId, branchFilter = null, branchFieldName = "Vanir Branch") {
  const datalist = document.getElementById(datalistId);
  datalist.innerHTML = ""; // clear old

  let options = records
    .filter(rec => rec.fields[fieldName])
   .filter(rec => {
  if (!branchFilter) return true;
  if (!rec.fields[branchFieldName]) return false;

  // If the linked field stores NAMES (string), not IDs:
  return rec.fields[branchFieldName].includes(branchFilter);
})


    .map(rec => rec.fields[fieldName]);

  // Deduplicate + sort alphabetically
  options = [...new Set(options)].sort((a, b) => a.localeCompare(b));

  options.forEach(val => {
    const option = document.createElement("option");
    option.value = val;
    datalist.appendChild(option);
  });
}

// Populate a <select> dropdown
function populateSelectFromArray(records, fieldName, selectId, branchFilter = null, branchFieldName = "Vanir Branch") {
  const select = document.getElementById(selectId);
  select.innerHTML = `<option value="">-- Select --</option>`;

  let options = records
    .filter(rec => rec.fields[fieldName])
    .filter(rec => {
      if (!branchFilter) return true;
      if (!rec.fields[branchFieldName]) return false;

      console.log("Checking", rec.fields[fieldName], "branch link:", rec.fields[branchFieldName], "vs branchFilter:", branchFilter);
      return rec.fields[branchFieldName].includes(branchFilter);
    })
    .map(rec => rec.fields[fieldName]);

  // Deduplicate + sort
  options = [...new Set(options)].sort((a, b) => a.localeCompare(b));

  options.forEach(val => {
    const option = document.createElement("option");
    option.value = val;
    option.textContent = val;
    select.appendChild(option);
  });
}



// Init dropdowns
async function initDropdowns() {
  // Fetch all records
  const branches = await fetchAll(BRANCH_TABLE);
  subcontractorRecords = await fetchAll(SUBCONTRACTOR_TABLE);
  customerRecords = await fetchAll(CUSTOMER_TABLE);
  techRecords = await fetchAll(TECH_TABLE);

  // Build branch map (id → name)
  branches.forEach(b => {
    if (b.fields["Office Name"] && !excludedBranches.includes(b.fields["Office Name"])) {
      branchRecords[b.id] = b.fields["Office Name"];
    }
  });

// Populate branch dropdown
populateBranchDropdown(branches);

// Populate full lists initially (no filter)
populateSelectFromArray(subcontractorRecords, "Subcontractor Company Name", "subcontractor");
populateSelectFromArray(customerRecords, "Client Name", "customer");
populateSelectFromArray(techRecords, "Full Name", "technician");
}

// Handle branch selection → filter others
document.getElementById("branch").addEventListener("change", e => {
  const branchName = e.target.value; // we already have the name selected

  if (branchName) {
    // Compare by NAME instead of ID
    populateSelectFromArray(subcontractorRecords, "Subcontractor Company Name", "subcontractor", branchName, "Vanir Branch");
    populateSelectFromArray(customerRecords, "Client Name", "customer", branchName, "Division");
    populateSelectFromArray(techRecords, "Full Name", "technician", branchName, "Vanir Office");
  } else {
    populateSelectFromArray(subcontractorRecords, "Subcontractor Company Name", "subcontractor");
    populateSelectFromArray(customerRecords, "Client Name", "customer");
    populateSelectFromArray(techRecords, "Full Name", "technician");
  }
});



// Populate branch dropdown
function populateBranchDropdown(branches) {
  const branchSelect = document.getElementById("branch");
  branchSelect.innerHTML = `<option value="">-- Select Branch --</option>`;

  let options = branches
    .filter(b => b.fields["Office Name"] && !excludedBranches.includes(b.fields["Office Name"]))
    .map(b => b.fields["Office Name"])
    .sort((a, b) => a.localeCompare(b));

  options.forEach(name => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    branchSelect.appendChild(option);
  });
}

// Save backcharge
document.getElementById("backchargeForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const subcontractor = document.querySelector("#subcontractor").value;
  const customer = document.querySelector("#customer").value;
  const technician = document.querySelector("#technician").value;
  const branch = document.querySelector("#branch").value;

  const reason = document.querySelector("#reason").value;
  const amount = parseFloat(document.querySelector("#amount").value);

  const payload = {
    fields: {
      "Subcontractor to Backcharge": [await findRecordId(SUBCONTRACTOR_TABLE, "Subcontractor Company Name", subcontractor)],
      "Customer": [await findRecordId(CUSTOMER_TABLE, "Client Name", customer)],
      "Field Technician": [await findRecordId(TECH_TABLE, "Full Name", technician)],
      "Vanir Branch": [await findRecordId(BRANCH_TABLE, "Office Name", branch)],
      "Reason for Backcharge": reason,
      "Backcharge Amount": amount
    }
  };

  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    alert("Backcharge submitted!");
    document.getElementById("backchargeForm").reset();
  } else {
    alert("Error submitting backcharge.");
  }
});

// Helper: find recordId by name
async function findRecordId(tableId, fieldName, value) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?filterByFormula={${encodeURIComponent(fieldName)}}="${value}"`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } });
  const data = await res.json();
  return data.records[0]?.id || null;
}

// Run init
initDropdowns();
