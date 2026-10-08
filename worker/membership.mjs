// Only the Sites dispatch may populate these identity headers. Never expose
// this Worker through a second, untrusted origin that preserves client headers.
export async function requireSiteMembership(request, env, { fetchImpl = fetch } = {}) {
  if (!request.headers.get("oai-authenticated-user-id")) throw Object.assign(new Error("Connectez-vous avec ChatGPT."), { code: "AUTH_REQUIRED", status: 401 });
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (!email) throw Object.assign(new Error("Identité de connexion incomplète."), { code: "AUTH_REQUIRED", status: 401 });
  const projectRef = env?.SETTLEMESH_SUPABASE_PROJECT_REF;
  const serviceKey = env?.SETTLEMESH_SUPABASE_SERVICE_KEY;
  if (!projectRef || !serviceKey) throw Object.assign(new Error("Gestion des membres non configurée."), { code: "MEMBERS_UNAVAILABLE", status: 503 });
  let response;
  try {
    response = await fetchImpl(`https://${projectRef}.supabase.co/rest/v1/settlemesh_members?email=eq.${encodeURIComponent(email)}&select=organization_id,role&limit=2`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  } catch { throw Object.assign(new Error("Gestion des membres indisponible."), { code: "MEMBERS_UNAVAILABLE", status: 503 }); }
  if (!response.ok) throw Object.assign(new Error("Gestion des membres indisponible."), { code: "MEMBERS_UNAVAILABLE", status: 503 });
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1 || !["owner", "admin", "viewer"].includes(rows[0].role) || !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(rows[0].organization_id || "")) throw Object.assign(new Error("Aucun espace acheteur autorisé pour ce compte. Une invitation préalable est nécessaire."), { code: "MEMBERSHIP_REQUIRED", status: 403 });
  return { organizationId: rows[0].organization_id, role: rows[0].role };
}
