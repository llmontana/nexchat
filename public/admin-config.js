export const ADMIN_EMAILS = ["sametyesr7@gmail.com"];

export function isAdminEmail(email) {
  if (typeof email !== "string") {
    return false;
  }

  return ADMIN_EMAILS.includes(email.trim().toLocaleLowerCase("tr-TR"));
}
