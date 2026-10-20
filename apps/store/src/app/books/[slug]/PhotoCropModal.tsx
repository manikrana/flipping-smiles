"use client";

import { useRef, useState } from "react";
import ReactCrop, { centerCrop, makeAspectCrop, clamp, cropToCanvas, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

// Portrait, passport-photo-style ratio -- gives Gemini a consistent,
// well-framed face/shoulders crop to work from instead of whatever
// arbitrary framing the customer's original photo happened to have.
const CROP_ASPECT = 4 / 5;

function defaultCenteredCrop(displayWidth: number, displayHeight: number): PixelCrop {
  return centerCrop(
    makeAspectCrop({ unit: "px", width: displayWidth * 0.9 }, CROP_ASPECT, displayWidth, displayHeight),
    displayWidth,
    displayHeight
  );
}

export function PhotoCropModal({
  file,
  onConfirm,
  onCancel,
}: {
  file: File;
  onConfirm: (croppedFile: File) => void;
  onCancel: () => void;
}) {
  // Not revoked on unmount -- React's dev-mode Strict Mode double-invokes
  // effect cleanups (mount -> cleanup -> mount) without recreating this
  // useState initializer, which would revoke the URL out from under the
  // still-loading <img>. This modal is short-lived and creates at most one
  // blob URL per photo selection, so leaving it for the browser to garbage
  // collect is a trivial cost.
  const [imgSrc] = useState(() => URL.createObjectURL(file));
  const [crop, setCrop] = useState<PixelCrop | null>(null);
  const [detecting, setDetecting] = useState(true);
  const [faceFound, setFaceFound] = useState<boolean | null>(null);
  const [cropping, setCropping] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Runs once, when the (hidden, detection-only) image first loads: tries to
  // find a face via a tiny client-side model and frame a passport-style box
  // around it. Falls back to a centered box on any failure -- this is a
  // starting point the customer can always drag/resize afterward, never a
  // hard requirement.
  async function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    const { width: dw, height: dh, naturalWidth: nw, naturalHeight: nh } = img;

    try {
      const faceapi = await import("@vladmandic/face-api");
      if (!faceapi.nets.tinyFaceDetector.isLoaded) {
        await faceapi.nets.tinyFaceDetector.loadFromUri("/models");
      }
      const detection = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions());

      if (detection) {
        const box = detection.box; // natural-pixel coordinates
        const scale = dw / nw; // natural -> displayed

        // TinyFaceDetector's box only spans eyebrow-line to chin -- it does
        // NOT include forehead-above-eyebrows, hair, or hairstyle volume.
        // Anchoring off its top/bottom edges (not its center) with generous,
        // separately-tuned margins on each side gives predictable headroom
        // for hair regardless of face proportions: 0.65x the face height
        // above the eyebrow line (forehead + hair + a little frame margin)
        // and 0.55x below the chin (neck + shoulders), for a passport-style
        // frame where the head reads as clearly separate from the edges.
        const topMargin = box.height * 0.65;
        const bottomMargin = box.height * 0.55;
        let cropHNatural = box.height + topMargin + bottomMargin;
        let cropWNatural = cropHNatural * CROP_ASPECT;
        if (cropWNatural > nw) { cropWNatural = nw; cropHNatural = cropWNatural / CROP_ASPECT; }
        if (cropHNatural > nh) { cropHNatural = nh; cropWNatural = cropHNatural * CROP_ASPECT; }

        const faceCenterX = box.x + box.width / 2;
        const cropXNatural = clamp(faceCenterX - cropWNatural / 2, 0, nw - cropWNatural);
        const cropYNatural = clamp(box.y - topMargin, 0, nh - cropHNatural);

        setCrop({
          unit: "px",
          x: cropXNatural * scale,
          y: cropYNatural * scale,
          width: cropWNatural * scale,
          height: cropHNatural * scale,
        });
        setFaceFound(true);
      } else {
        setCrop(defaultCenteredCrop(dw, dh));
        setFaceFound(false);
      }
    } catch (err) {
      console.error("[photo-crop] face detection failed:", err);
      setCrop(defaultCenteredCrop(dw, dh));
      setFaceFound(false);
    } finally {
      setDetecting(false);
    }
  }

  async function handleConfirm() {
    if (!crop || !imgRef.current) return;
    setCropping(true);
    try {
      const canvas = document.createElement("canvas");
      await cropToCanvas(imgRef.current, canvas, crop);
      canvas.toBlob(
        (blob) => {
          if (!blob) { setCropping(false); return; }
          const cropped = new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
          onConfirm(cropped);
        },
        "image/jpeg",
        0.92
      );
    } catch (err) {
      console.error("[photo-crop] crop failed:", err);
      setCropping(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-5 max-w-sm w-full space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-ink">Frame the photo</h3>
          <p className="text-xs text-ink/40 mt-0.5">
            {detecting
              ? "Finding the face…"
              : faceFound
                ? "Drag the corners to adjust the frame."
                : "Couldn't auto-detect a face — drag to frame it yourself."}
          </p>
        </div>

        <div className="flex justify-center items-center bg-cream rounded-xl overflow-hidden min-h-[220px]">
          {!crop && (
            // Invisible-but-laid-out detection-only image -- its onLoad drives
            // the initial crop box, using its OWN rendered width/height to
            // convert the face box (in natural pixels) into display pixels.
            // Must stay laid out (not display:none/"hidden") or img.width/
            // img.height read back as 0, collapsing the computed crop box
            // toward the corner -- same max-h/w-auto sizing as the visible
            // cropped image below so the scale factor matches exactly.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imgSrc} alt="" onLoad={onImageLoad} className="max-h-[60vh] w-auto opacity-0" />
          )}
          {crop && (
            <ReactCrop crop={crop} onChange={setCrop} aspect={CROP_ASPECT} minWidth={60} keepSelection className="max-h-[60vh]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img ref={imgRef} src={imgSrc} alt="Selected" className="max-h-[60vh] w-auto" />
            </ReactCrop>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={onCancel} className="text-xs text-ink/40 hover:text-accent-500 transition-colors">
            Choose a different photo
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!crop || cropping || detecting}
            className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-xl transition-colors"
          >
            {cropping ? "Cropping…" : "Use this photo"}
          </button>
        </div>
      </div>
    </div>
  );
}
