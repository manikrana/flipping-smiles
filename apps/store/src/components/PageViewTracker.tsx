"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/track";

export function PageViewTracker() {
  const pathname = usePathname();

  useEffect(() => {
    track("page_view", {
      properties: {
        path: pathname,
        referrer: document.referrer || undefined,
      },
    });
  }, [pathname]);

  return null;
}
