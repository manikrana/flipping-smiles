"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function unlock(formData: FormData) {
  const password = formData.get("password") as string;
  const from = (formData.get("from") as string) || "/";

  if (password === process.env.SITE_PASSWORD) {
    (await cookies()).set("flippingsmiles_unlocked", password, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
    redirect(from);
  }

  redirect(`/unlock?from=${encodeURIComponent(from)}&error=1`);
}
