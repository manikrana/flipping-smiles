"use client";

import { useRef, useState } from "react";
import { submitFeedback, uploadFeedbackImage } from "@/app/feedback/actions";

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"bug" | "feature">("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setImage(file);
    setImagePreview(file ? URL.createObjectURL(file) : null);
  }

  function handleClose() {
    setOpen(false);
    setStatus("idle");
    setTitle("");
    setDescription("");
    setImage(null);
    setImagePreview(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleSubmit() {
    if (!title.trim() || !description.trim()) return;
    setStatus("submitting");
    const image_url = image ? await uploadFeedbackImage(image) : null;
    await submitFeedback({ type, title, description, url: window.location.href, image_url });
    setStatus("done");
    setTimeout(handleClose, 2000);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 bg-brand-600 text-white text-sm px-4 py-2 rounded-full shadow-lg hover:bg-brand-700 transition-colors z-50"
      >
        Feedback
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-bold mb-4">Leave Feedback</h2>

            {status === "done" ? (
              <p className="text-green-600 text-center py-6">Thanks! We&apos;ll look into it.</p>
            ) : (
              <>
                <div className="flex gap-2 mb-4">
                  <button
                    onClick={() => setType("bug")}
                    className={`flex-1 py-2 rounded-lg border text-sm transition-colors ${type === "bug" ? "bg-red-50 border-red-400 text-red-700 font-medium" : "border-gray-200 text-gray-600"}`}
                  >
                    🐛 Bug
                  </button>
                  <button
                    onClick={() => setType("feature")}
                    className={`flex-1 py-2 rounded-lg border text-sm transition-colors ${type === "feature" ? "bg-blue-50 border-blue-400 text-blue-700 font-medium" : "border-gray-200 text-gray-600"}`}
                  >
                    ✨ Feature
                  </button>
                </div>

                <input
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 mb-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                  placeholder="Short title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />

                <textarea
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 mb-3 text-sm h-28 resize-none focus:outline-none focus:ring-2 focus:ring-brand-300"
                  placeholder="Describe the issue or feature in detail..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />

                {imagePreview ? (
                  <div className="relative mb-4">
                    <img src={imagePreview} alt="Attachment" className="w-full h-32 object-cover rounded-lg border border-gray-200" />
                    <button
                      onClick={() => { setImage(null); setImagePreview(null); if (fileRef.current) fileRef.current.value = ""; }}
                      className="absolute top-1 right-1 bg-black/50 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-black/70"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="w-full mb-4 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-400 hover:border-gray-400 hover:text-gray-500 transition-colors"
                  >
                    + Attach image (optional)
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />

                <div className="flex gap-2">
                  <button onClick={handleClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={!title.trim() || !description.trim() || status === "submitting"}
                    className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-40 transition-colors"
                  >
                    {status === "submitting" ? "Sending..." : "Submit"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
