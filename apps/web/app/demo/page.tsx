import { redirect } from "next/navigation";

const DEMO_STUDY_ID = "35662f3d8b7";

export default function DemoStudyPage() {
  redirect(`/${DEMO_STUDY_ID}`);
}
