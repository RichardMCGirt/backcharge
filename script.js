const AIRTABLE_API_KEY = "pat6QyOfQCQ9InhK4.4b944a38ad4c503a6edd9361b2a6c1e7f02f216ff05605f7690d3adb12c94a3c";
     const BASE_ID = "appQDdkj6ydqUaUkE";
  const TABLE_ID = "tblg98QfBxRd6uivq";

  // Linked tables
  const SUBCONTRACTOR_TABLE = "tblgsUP8po27WX7Hb";
  const CUSTOMER_TABLE = "tblQ7yvLoLKZlZ9yU";
  const TECH_TABLE = "tblj6Fp0rvN7QyjRv";


  // Cache to avoid repeated API calls
const recordCache = {};

async function fetchAllRecords(tableId, keyFields) {
  let allRecords = [];
  let offset = null;

  do {
    let url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?pageSize=100`;
    if (offset) url += `&offset=${offset}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } });
    if (!res.ok) break;

    const data = await res.json();
    allRecords = allRecords.concat(data.records);
    offset = data.offset;
  } while (offset);

  // Build cache by recordId → displayName
  for (const rec of allRecords) {
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
  await fetchAllRecords("tblgsUP8po27WX7Hb", ["Subcontractor Company Name"]);
  await fetchAllRecords("tblQ7yvLoLKZlZ9yU", ["Client Name"]);
  await fetchAllRecords("tblj6Fp0rvN7QyjRv", ["Full Name"]);
}

function getCachedRecord(tableId, recordId) {
  return recordCache[`${tableId}_${recordId}`] || recordId;
}


 async function fetchBackcharges() {
  let allRecords = [];
  let offset = null;

  do {
    let url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?view=viwTHoVVR3TsPDR6k`;
    if (offset) {
      url += `&offset=${offset}`;
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
    });

    if (!response.ok) {
      console.error("Error fetching Airtable data:", response.statusText);
      break;
    }

    const data = await response.json();
    allRecords = allRecords.concat(data.records);

    // Airtable includes an `offset` key if there are more records
    offset = data.offset;
  } while (offset);

  // Now render all records
  const tbody = document.querySelector("#backchargesTable tbody");
  tbody.innerHTML = "";

  for (const record of allRecords) {
    const fields = record.fields;

    let subcontractor = "";
    let customer = "";
    let technician = "";

   if (fields["Subcontractor to Backcharge"]) {
  subcontractor = fields["Subcontractor to Backcharge"]
    .map(id => getCachedRecord(SUBCONTRACTOR_TABLE, id))
    .join(", ");
}

if (fields["Customer"]) {
  customer = fields["Customer"]
    .map(id => getCachedRecord(CUSTOMER_TABLE, id))
    .join(", ");
}

if (fields["Field Technician"]) {
  technician = fields["Field Technician"]
    .map(id => getCachedRecord(TECH_TABLE, id))
    .join(", ");
}

    const reason = fields["Reason for Backcharge"] || "";
    let amount = fields["Backcharge Amount"] || "";
    if (amount !== "") {
      amount = `$${parseFloat(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    const row = `
      <tr>
        <td>${subcontractor}</td>
        <td>${customer}</td>
        <td>${technician}</td>
        <td>${reason}</td>
        <td>${amount}</td>
      </tr>
    `;
    tbody.insertAdjacentHTML("beforeend", row);
  }
}
(async () => {
  await preloadLinkedTables();
  await fetchBackcharges();
})();


  fetchBackcharges();