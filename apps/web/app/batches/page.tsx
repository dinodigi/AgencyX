import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Batch building is now a mode of Search — keep the old link working. */
export default function BatchesPage() {
  redirect("/search?mode=batch");
}
