"use server";

import { revalidatePath } from "next/cache";
import { setSignal } from "@/lib/db";

export async function submitSignal(articleId: number, value: 1 | -1) {
  setSignal(articleId, value);
  revalidatePath("/");
}
