export async function checkIsAdmin(idToken) {
  try {
    const response = await fetch("/api/admin/check", {
      headers: { Authorization: `Bearer ${idToken}` }
    });
    const data = await response.json();
    return Boolean(data?.isAdmin);
  } catch {
    return false;
  }
}
