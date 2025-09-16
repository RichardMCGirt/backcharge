let dropboxAccessToken = null;

function getEnv(key, fallback = undefined) {
  return (window.env && window.env[key]) || fallback;
}

function getTokenSource() {
  // Prefer dedicated token base/key if provided
  const baseId  = getEnv("DROPBOX_TOKEN_BASE_ID",  getEnv("AIRTABLE_BASE_ID"));
  const apiKey  = getEnv("DROPBOX_TOKEN_API_KEY",  getEnv("AIRTABLE_API_KEY"));
  const tableId = getEnv("DROPBOX_TOKEN_TABLE_ID", "tbl6EeKPsNuEvt5yJ");
  return { baseId, apiKey, tableId };
}

export async function fetchDropboxToken() {
  const { baseId, apiKey, tableId } = getTokenSource();
  if (!baseId || !apiKey || !tableId) {
    console.error("❌ Missing env for Dropbox token source");
    return null;
  }

  const url = `https://api.airtable.com/v0/${baseId}/${tableId}?maxRecords=1`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(`❌ Token fetch failed ${response.status}: ${text || "(no body)"}`);
      return null;
    }

    const data = await response.json();
    const record = Array.isArray(data.records) && data.records.length ? data.records[0] : null;
    if (!record) return null;

    const fields = record.fields || {};
    const token        = fields["Dropbox Token"];
    const refreshToken = fields["Dropbox Refresh Token"];
    const appKey       = fields["Dropbox App Key"];
    const appSecret    = fields["Dropbox App Secret"];

    if (!appKey || !appSecret) return null;

    if (token) {
      dropboxAccessToken = token;
      return { token, appKey, appSecret, refreshToken };
    }

    if (refreshToken) {
      const newToken = await refreshDropboxAccessToken(refreshToken, appKey, appSecret);
      return newToken ? { token: newToken, appKey, appSecret, refreshToken } : null;
    }

    return null;

  } catch (err) {
    console.error("❌ Error fetching Dropbox token:", err);
    return null;
  }
}

export async function refreshDropboxAccessToken(refreshToken, appKey, appSecret) {
  const url = "https://api.dropboxapi.com/oauth2/token";

  const params = new URLSearchParams();
  params.append("grant_type", "refresh_token");
  params.append("refresh_token", refreshToken);
  params.append("client_id", appKey);
  params.append("client_secret", appSecret);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ Token refresh failed:", data);
      return null;
    }

    dropboxAccessToken = data.access_token;

    await updateDropboxTokenInAirtable(dropboxAccessToken);

    return dropboxAccessToken;

  } catch (error) {
    console.error("❌ Error refreshing Dropbox access token:", error);
    return null;
  }
}

async function updateDropboxTokenInAirtable(token) {
  const { baseId, apiKey, tableId } = getTokenSource();
  if (!baseId || !apiKey || !tableId) return;

  const url = `https://api.airtable.com/v0/${baseId}/${tableId}?maxRecords=1`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) return;

  const data = await res.json();
  const recordId = data.records?.[0]?.id;
  if (!recordId) return;

  const patchUrl = `https://api.airtable.com/v0/${baseId}/${tableId}/${recordId}`;
  await fetch(patchUrl, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fields: { "Dropbox Token": token } })
  });
}

export async function uploadFileToDropbox(file, token, creds = {}) {
  const dropboxUploadUrl = "https://content.dropboxapi.com/2/files/upload";
  const path = `/uploads/${encodeURIComponent(file.name)}`;

  try {
    const response = await fetch(dropboxUploadUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Dropbox-API-Arg": JSON.stringify({
          path: path,
          mode: "add",
          autorename: true,
          mute: false
        }),
        "Content-Type": "application/octet-stream"
      },
      body: file
    });

    if (!response.ok) {
      // Retry once on expired token
      let errorResponse = null;
      try { errorResponse = await response.json(); } catch {}
      const tag = errorResponse?.error?.[".tag"];
      if (tag === "expired_access_token" && creds?.refreshToken && creds?.appKey && creds?.appSecret) {
        const newToken = await refreshDropboxAccessToken(creds.refreshToken, creds.appKey, creds.appSecret);
        if (newToken) {
          return await uploadFileToDropbox(file, newToken, creds);
        }
      }
      console.error("❌ Upload failed:", errorResponse || response.status);
      return null;
    }

    const data = await response.json();
    return await getDropboxSharedLink(data.path_lower);

  } catch (error) {
    console.error("❌ Upload error:", error);
    return null;
  }
}

export async function getDropboxSharedLink(filePath) {
  const url = "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings";
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dropboxAccessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        path: filePath,
        settings: { requested_visibility: "public" }
      })
    });

    if (response.status === 409) {
      return await getExistingDropboxLink(filePath);
    }

    if (!response.ok) {
      const t = await response.text().catch(() => "");
      throw new Error("❌ Error creating Dropbox shared link: " + t);
    }

    const data = await response.json();
    return convertToDirectLink(data.url);

  } catch (error) {
    console.error("❌ Dropbox link error:", error);
    return null;
  }
}

export async function getExistingDropboxLink(filePath) {
  const url = "https://api.dropboxapi.com/2/sharing/list_shared_links";
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dropboxAccessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        path: filePath,
        direct_only: true
      })
    });

    if (!response.ok) {
      const t = await response.text().catch(() => "");
      console.error("❌ list_shared_links failed:", t);
      return null;
    }

    const data = await response.json();
    if (Array.isArray(data.links) && data.links.length > 0) {
      return convertToDirectLink(data.links[0].url);
    }

    return null;

  } catch (error) {
    console.error("❌ Error fetching existing Dropbox link:", error);
    return null;
  }
}

export function convertToDirectLink(sharedUrl) {
  return sharedUrl
    .replace("www.dropbox.com", "dl.dropboxusercontent.com")
    .replace("?dl=0", "?raw=1");
}
