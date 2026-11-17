import { redirect } from "next/navigation";
import { LoginForm } from "@/components/admin/LoginForm";
import { isAdminSession } from "@/components/admin/guard";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await isAdminSession()) redirect("/admin");
  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-6 text-2xl font-bold">Admin login</h1>
      <LoginForm />
    </main>
  );
}
