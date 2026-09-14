import { redirect } from "next/navigation";

/** Legacy path — User Management moved to /admin/users */
export default function RegistrationsRedirect() {
  redirect("/admin/users");
}
