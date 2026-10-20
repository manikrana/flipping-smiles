"use client";

import { useRef } from "react";
import { track } from "@/lib/track";

interface TrackedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** Where this image appears — shows up in the failure event's properties, e.g. "book_cover", "character_option". */
  context: string;
  storyId?: string;
  orderId?: string;
}

/** Plain <img> that reports an "image_load_failed" analytics event (visible in the Studio dashboard) if the src fails to load. */
export function TrackedImage({ context, storyId, orderId, src, onError, ...rest }: TrackedImageProps) {
  const reported = useRef(false);

  function handleError(e: React.SyntheticEvent<HTMLImageElement, Event>) {
    if (!reported.current) {
      reported.current = true;
      track("image_load_failed", {
        story_id: storyId,
        order_id: orderId,
        properties: { context, src },
      });
    }
    onError?.(e);
  }

  return <img src={src} onError={handleError} {...rest} />;
}
