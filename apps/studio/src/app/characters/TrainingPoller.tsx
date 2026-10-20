"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { checkTrainingStatuses } from "./lora/actions";

interface Props {
  jobs: { characterId: string; trainingId: string }[];
}

export function TrainingPoller({ jobs }: Props) {
  const router = useRouter();

  useEffect(() => {
    if (jobs.length === 0) return;

    const interval = setInterval(async () => {
      const results = await checkTrainingStatuses(jobs);
      if (results.some((r) => r.status !== "training")) {
        router.refresh();
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [jobs, router]);

  return null;
}
