/* =============================
   form.js – Backcharge form (robust)
   - Proper filterByFormula encoding (handles &, quotes)
   - Case/space-insensitive match via LOWER/TRIM
   - Guards against undefined records (no [0] crash)
   - Clear console diagnostics on 422s
   ============================= */

// ---- Airtable config ----
const AIRTABLE_API_KEY = "pat6QyOfQCQ9InhK4.4b944a38ad4c503a6edd9361b2a6c1e7f02f216ff05605f7690d3adb12c94a3c";
const BASE_ID = "appQDdkj6ydqUaUkE";
const TABLE_ID = "tbl1LwBCXM0DYQSJH"; // Backcharges table

// Linked tables
const SUBCONTRACTOR_TABLE = "tblgsUP8po27WX7Hb";
const CUSTOMER_TABLE      = "tblQ7yvLoLKZlZ9yU";
const TECH_TABLE          = "tblj6Fp0rvN7QyjRv";
const BRANCH_TABLE        = "tblD2gLfkTtJYIhmK";

// Cache data for filtering
let branchRecords = {};
let subcontractorRecords = [];
let customerRecords = [];
let techRecords = [];

// Excluded branches
const excludedBranches = ["Test Branch", "Airtable Hail Mary Test", "AT HM Test"];

// ---- Utils ----
function atHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function fetchAll(tableId) {
  let allRecords = [];
  let offset = null;
  try {
    do {
      let url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?pageSize=100`;
      if (offset) url += `&offset=${offset}`;
      const res = await fetch(url, { headers: atHeaders() });
      const data = await res.json();
      if (!res.ok) {
        console.error("fetchAll error:", tableId, data);
        break;
      }
      if (Array.isArray(data.records)) allRecords = allRecords.concat(data.records);
      offset = data.offset;
    } while (offset);
  } catch (err) {
    console.error("fetchAll exception:", tableId, err);
  }
  return allRecords;
}

// Escape internal double-quotes for Airtable string literal
function escapeAirtableString(value) {
  return String(value ?? "").replace(/"/g, '\\"');
}

// Build a case-insensitive, space-insensitive formula:
//   LOWER(TRIM({Field})) = LOWER("value")
function makeFilterFormulaInsensitive(fieldName, rawValue) {
  const trimmed = String(rawValue ?? "").trim();
  const safe = escapeAirtableString(trimmed);
  return `LOWER(TRIM({${fieldName}})) = LOWER("${safe}")`;
}

// Helper: find recordId by text match (case/space-insensitive)
async function findRecordId(tableId, fieldName, value) {
  if (!value) return null;
  const formula = makeFilterFormulaInsensitive(fieldName, value);
  const url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;

  // For debugging visibility:
  console.debug("[findRecordId] GET", { tableId, fieldName, value, url, formulaRaw: formula });

  const res = await fetch(url, { headers: atHeaders() });
  let data = {};
  try { data = await res.json(); } catch (_) {}

  if (!res.ok) {
    console.error("findRecordId error:", { status: res.status, url, data });
    return null;
  }
  return data.records?.[0]?.id ?? null;
}

// Populate a datalist with sorted values
function populateDatalistFromArray(records, fieldName, datalistId, branchFilter = null, branchFieldName = "Vanir Branch") {
  const datalist = document.getElementById(datalistId);
  if (!datalist) return;
  datalist.innerHTML = ""; // clear old

  let options = records
    .filter(rec => rec.fields && rec.fields[fieldName])
    .filter(rec => {
      if (!branchFilter) return true;
      if (!rec.fields[branchFieldName]) return false;
      const v = rec.fields[branchFieldName];
      return Array.isArray(v) ? v.includes(branchFilter) : v === branchFilter;
    })
    .map(rec => rec.fields[fieldName]);

  // Deduplicate + sort alphabetically
  options = [...new Set(options)].sort((a, b) => String(a).localeCompare(String(b)));

  options.forEach(val => {
    const option = document.createElement("option");
    option.value = val;
    datalist.appendChild(option);
  });
}

// Populate a <select> dropdown
function populateSelectFromArray(records, fieldName, selectId, branchFilter = null, branchFieldName = "Vanir Branch") {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.innerHTML = `<option value="">-- Select --</option>`;

  let options = records
    .filter(rec => rec.fields && rec.fields[fieldName])
    .filter(rec => {
      if (!branchFilter) return true;
      if (!rec.fields[branchFieldName]) return false;
      const v = rec.fields[branchFieldName];
      const match = Array.isArray(v) ? v.includes(branchFilter) : v === branchFilter;
      return match;
    })
    .map(rec => rec.fields[fieldName]);

  options = [...new Set(options)].sort((a, b) => String(a).localeCompare(String(b)));

  options.forEach(val => {
    const option = document.createElement("option");
    option.value = val;
    option.textContent = val;
    select.appendChild(option);
  });
}

// Populate branch dropdown
function populateBranchDropdown(branches) {
  const branchSelect = document.getElementById("branch");
  if (!branchSelect) return;
  branchSelect.innerHTML = `<option value="">-- Select Branch --</option>`;

  let options = branches
    .filter(b => b.fields && b.fields["Office Name"] && !excludedBranches.includes(b.fields["Office Name"]))
    .map(b => b.fields["Office Name"])
    .sort((a, b) => String(a).localeCompare(String(b)));

  options.forEach(name => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    branchSelect.appendChild(option);
  });
}

// Init dropdowns
async function initDropdowns() {
  const branches = await fetchAll(BRANCH_TABLE);
  subcontractorRecords = await fetchAll(SUBCONTRACTOR_TABLE);
  customerRecords      = await fetchAll(CUSTOMER_TABLE);
  techRecords          = await fetchAll(TECH_TABLE);

  branches.forEach(b => {
    if (b.fields && b.fields["Office Name"] && !excludedBranches.includes(b.fields["Office Name"])) {
      branchRecords[b.id] = b.fields["Office Name"];
    }
  });

  populateBranchDropdown(branches);

  // Populate full lists initially (no filter)
  populateSelectFromArray(subcontractorRecords, "Subcontractor Company Name", "subcontractor");
  populateSelectFromArray(customerRecords,      "Client Name",                "customer");
  populateSelectFromArray(techRecords,          "Full Name",                  "technician");
}

// Handle branch selection → filter others
const branchEl = document.getElementById("branch");
if (branchEl) {
  branchEl.addEventListener("change", e => {
    const branchName = e.target.value; // branch NAME
    if (branchName) {
      populateSelectFromArray(subcontractorRecords, "Subcontractor Company Name", "subcontractor", branchName, "Vanir Branch");
      populateSelectFromArray(customerRecords,      "Client Name",                "customer",     branchName, "Division");
      populateSelectFromArray(techRecords,          "Full Name",                  "technician",   branchName, "Vanir Office");
    } else {
      populateSelectFromArray(subcontractorRecords, "Subcontractor Company Name", "subcontractor");
      populateSelectFromArray(customerRecords,      "Client Name",                "customer");
      populateSelectFromArray(techRecords,          "Full Name",                  "technician");
    }
  });
}

// ---- Submit handler ----
const formEl = document.getElementById("backchargeForm");
if (formEl) {
  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();

    const subcontractor = document.querySelector("#subcontractor")?.value ?? "";
    const customer      = document.querySelector("#customer")?.value ?? "";
    const technician    = document.querySelector("#technician")?.value ?? "";
    const branch        = document.querySelector("#branch")?.value ?? "";
    const jobName       = document.querySelector("#jobName")?.value ?? "";
    const reason        = document.querySelector("#reason")?.value ?? "";

    const subcontractorClean = subcontractor; // findRecordId trims + normalizes
    const customerClean      = customer;
    const technicianClean    = technician;
    const branchClean        = branch;

    const amountRaw = document.querySelector("#amount")?.value;
    const amount = amountRaw === "" || amountRaw == null ? null : parseFloat(amountRaw);

    // Resolve linked record IDs in parallel
    const [subId, custId, techId, branchId] = await Promise.all([
      findRecordId(SUBCONTRACTOR_TABLE, "Subcontractor Company Name", subcontractorClean),
      findRecordId(CUSTOMER_TABLE,      "Client Name",                customerClean),
      findRecordId(TECH_TABLE,          "Full Name",                  technicianClean),
      findRecordId(BRANCH_TABLE,        "Office Name",                branchClean),
    ]);

    const missing = [];
    if (!subId)    missing.push(`Subcontractor: "${subcontractorClean || "(empty)"}"`);
    if (!custId)   missing.push(`Customer: "${customerClean || "(empty)"}"`);
    if (!techId)   missing.push(`Technician: "${technicianClean || "(empty)"}"`);
    if (!branchId) missing.push(`Branch: "${branchClean || "(empty)"}"`);

    if (missing.length) {
      alert(
        "Couldn't find the following in Airtable (check exact spelling / renamed fields?):\n\n" +
        missing.join("\n") +
        "\n\nNote: lookups are case/space-insensitive (LOWER/TRIM). If it still fails, the value likely doesn't exist in the referenced table."
      );
      return;
    }

    const fields = {
      "Subcontractor to Backcharge": [subId],
      "Customer":                    [custId],
      "Field Technician":            [techId],
      "Vanir Branch":                [branchId],
      "Job Name":                     jobName.trim() || undefined,
      "Reason for Backcharge":        reason.trim()  || undefined,
    };

    if (amount !== null && !Number.isNaN(amount)) {
      fields["Backcharge Amount"] = amount;
    }

    const payload = { fields };

    try {
      const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`, {
        method: "POST",
        headers: atHeaders(),
        body: JSON.stringify(payload),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("Create backcharge failed:", { status: res.status, body, payload });
        alert(`Error submitting backcharge (HTTP ${res.status}).\n\n` +
              (body?.error?.message || JSON.stringify(body, null, 2)) +
              "\n\nCheck console for details.");
        return;
      }

      alert("Backcharge submitted!");
      formEl.reset();
    } catch (err) {
      console.error("Submit exception:", err);
      alert("Network or script error. See console.");
    }
  });
}

// ---- Bootstrap ----
initDropdowns().catch(err => console.error("initDropdowns exception:", err));
