export const DASHBOARD_URL_JS = `
// Dashboard URL sanitization（#131）
var dashboardUrlSafe = (function () {
  function safeExternalUrl(raw) {
    if (typeof raw !== "string" || raw.length === 0) return null;
    var parsed;
    try {
      parsed = new URL(raw);
    } catch (error) {
      return null;
    }
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
    return null;
  }
  return { safeExternalUrl: safeExternalUrl };
})();
`;