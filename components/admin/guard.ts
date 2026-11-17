import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ADMIN_COOKIE, verifyAdminCookie } from "@/lib/admin-auth";

export async function isAdminSession(): Promise<boolean> {
  const jar = await cookies();
  return verifyAdminCookie(jar.get(ADMIN_COOKIE)?.value);
}

/** Server side page guard. Call first in every admin page except login. */
export async function requireAdminPage(): Promise<void> {
  if (!(await isAdminSession())) redirect("/admin/login");
}

export function assertUuid(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  return id;
}
