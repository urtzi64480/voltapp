import { redirect } from "next/navigation";

// UUID Elektron — même exception que demande/page.tsx (hardcodé volontairement).
const USER_ID = "d506c94e-40c7-4bcd-a48c-97e86f4ea7c0";

export default function Home() {
  redirect(`/demande/${USER_ID}`);
}
