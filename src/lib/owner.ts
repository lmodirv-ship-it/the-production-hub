// البريد الوحيد المسموح له بالدخول إلى الاستوديو.
export const OWNER_EMAIL = "lmodirv@gmail.com";

export function isOwner(email?: string | null) {
  return (email ?? "").trim().toLowerCase() === OWNER_EMAIL;
}
