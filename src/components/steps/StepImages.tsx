"use client";

import { useCallback, useEffect, useState } from "react";
import { useWizard } from "../WizardProvider";
// getImageUploadPath was tied to the Astro /uploads/YYYY/MM/ structure.
// In the WP target, images live under /wp-content/uploads/... assigned by
// WP at upload time, so the wizard just shows a flat preview path.
function previewPathFor(filename: string): string {
  return `/uploads/${filename}`;
}
import { CROP_POSITIONS, type CropPosition } from "@/lib/schema";

export function StepImages() {
  const { state, dispatch } = useWizard();
  const [processing, setProcessing] = useState(false);
  const [suggestingNames, setSuggestingNames] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filenamesSuggested, setFilenamesSuggested] = useState(false);

  const featuredImages = state.images.filter((i) => i.type === "featured");
  const bodyImages = state.images.filter((i) => i.type === "body");
  const pubDate = state.postMeta.pubDate || new Date().toISOString();

  // Auto-suggest filenames once on first step entry — only when no image has
  // been processed yet. Once an image is processed, its on-disk filename is
  // canonical (we'd otherwise overwrite seoFilename and silently break body
  // image insertions in Step 3 that derive paths from it on remount).
  useEffect(() => {
    if (
      state.images.length > 0 &&
      state.rawMarkdown &&
      !filenamesSuggested &&
      !state.images.some((i) => i.processed)
    ) {
      suggestFilenames();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function suggestFilenames() {
    if (!state.rawMarkdown || state.images.length === 0) return;
    setSuggestingNames(true);

    try {
      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field: "image-filenames",
          title: state.postMeta.title || state.parsedTitle || "",
          body: state.parsedBody.slice(0, 1500),
          imageCount: state.images.length,
          imageTypes: state.images.map((i) => i.type),
        }),
      });

      if (!response.ok) throw new Error("Failed to suggest filenames");
      const result = await response.json();

      if (Array.isArray(result.data)) {
        result.data.forEach((name: string, idx: number) => {
          const target = state.images[idx];
          // Skip images that have already been processed — their seoFilename
          // is locked to the on-disk filename and changing it would break
          // body-image insertions and re-publishing.
          if (target && !target.processed) {
            dispatch({
              type: "UPDATE_IMAGE",
              id: target.id,
              updates: { seoFilename: name },
            });
          }
        });
      }
      setFilenamesSuggested(true);
    } catch {
      // Silent fail — user can still type filenames manually
    } finally {
      setSuggestingNames(false);
    }
  }

  const processAllImages = useCallback(async () => {
    setProcessing(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("draftId", state.draftId || "temp");
      formData.append("pubDate", pubDate);

      // Append each image file + its metadata
      for (const img of state.images) {
        if (img.file) {
          formData.append("images", img.file);
          formData.append("imageTypes", img.type);
          formData.append("imageFilenames", img.seoFilename || "image");
          formData.append("imagePositions", img.cropPosition || "centre");
        }
      }

      const response = await fetch("/api/images/process", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error("Image processing failed");
      const result = await response.json();

      if (result.draftId && !state.draftId) {
        dispatch({ type: "SET_DRAFT_ID", id: result.draftId });
      }

      if (result.images) {
        // Merge processed data back into existing client images (keep thumbnails + files).
        // Adopt the server-assigned id so the publish route can locate scratch buffers
        // by `${img.id}-processed` / `${img.id}-social-processed`.
        const updatedImages = state.images.map((img, idx) => {
          const processed = result.images[idx];
          if (processed) {
            return {
              ...img,
              id: processed.id,
              processedName: processed.processedName,
              processedWidth: processed.processedWidth,
              processedHeight: processed.processedHeight,
              processedSize: processed.processedSize,
              repoPath: processed.repoPath,
              processed: true,
            };
          }
          return img;
        });
        dispatch({ type: "SET_IMAGES", images: updatedImages });

        // Auto-populate frontmatter.featuredImage from the processed featured
        // image, unless the user has already set one manually.
        const featured = updatedImages.find(
          (i) => i.type === "featured" && i.repoPath,
        );
        if (featured?.repoPath && !state.postMeta.featuredImage) {
          dispatch({
            type: "UPDATE_POST_META",
            fields: { featuredImage: featured.repoPath },
          });
        }
      }
      // (Press 400×400 variant was dropped — no AltEnergyMag/chamber circuit.)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Processing failed");
    } finally {
      setProcessing(false);
    }
  }, [state.images, state.draftId, pubDate, state.postMeta.featuredImage, dispatch]);

  if (state.images.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-white mb-1">Images</h2>
          <p className="text-sm text-[var(--muted)]">
            Review, rename, and process your images.
          </p>
        </div>
        <div className="text-center py-12 text-[var(--muted)]">
          <p>No images uploaded yet.</p>
          <p className="text-sm mt-1">Go back to Step 1 to upload images.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white mb-1">Images</h2>
          <p className="text-sm text-[var(--muted)]">
            Set SEO filenames, then process. Filenames matter for search rankings.
          </p>
        </div>
        <button
          onClick={suggestFilenames}
          disabled={suggestingNames || !state.rawMarkdown}
          className="shrink-0 px-3 py-1.5 rounded-lg bg-[var(--accent)]/20 text-[var(--accent)] text-xs font-medium hover:bg-[var(--accent)]/30 disabled:opacity-50"
        >
          {suggestingNames ? "Suggesting..." : "Suggest Filenames"}
        </button>
      </div>

      {/* Featured images */}
      {featuredImages.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-[var(--foreground)] mb-3">
            Featured Image
            <span className="text-[var(--muted)] font-normal ml-2">
              800×450 WebP · auto-generates social + press variants
            </span>
          </h3>
          <div className="space-y-3">
            {featuredImages.map((img) => (
              <ImageCard
                key={img.id}
                image={img}
                pubDate={pubDate}
                dispatch={dispatch}
              />
            ))}
          </div>
        </div>
      )}

      {/* Body images */}
      {bodyImages.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-[var(--foreground)] mb-3">
            Body Images
            <span className="text-[var(--muted)] font-normal ml-2">
              800×800 WebP
            </span>
          </h3>
          <div className="space-y-3">
            {bodyImages.map((img) => (
              <ImageCard
                key={img.id}
                image={img}
                pubDate={pubDate}
                dispatch={dispatch}
              />
            ))}
          </div>
        </div>
      )}

      {/* Process button */}
      <div className="flex items-center gap-4 pt-2">
        <button
          onClick={processAllImages}
          disabled={processing}
          className="px-5 py-2.5 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:bg-[var(--primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {processing ? "Processing..." : "Process All Images"}
        </button>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      </div>

      {/* Output spec */}
      <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--muted)] space-y-1">
        <p>
          <strong className="text-[var(--foreground)]">Featured:</strong>{" "}
          800×450, WebP q85, cover crop
        </p>
        <p>
          <strong className="text-[var(--foreground)]">Body:</strong> 800×800,
          WebP q85, cover crop
        </p>
        <p className="pt-1 text-[var(--muted)]">
          From the featured image, auto-generated:
        </p>
        <p className="pl-2">
          <strong className="text-[var(--foreground)]">Social (OG):</strong>{" "}
          1200×630, WebP q85 — committed for og:image
        </p>
        <p className="pl-2">
          <strong className="text-[var(--foreground)]">
            Social (Buffer wide):
          </strong>{" "}
          1200×630, JPG q88 — Facebook, GMB
        </p>
        <p className="pl-2">
          <strong className="text-[var(--foreground)]">
            Social (Buffer square):
          </strong>{" "}
          1080×1080, JPG q88 — Instagram
        </p>
        <p className="pl-2">
          <strong className="text-[var(--foreground)]">Press:</strong> 400×400,
          JPG q88 — chamber sites, AltEnergyMag
        </p>
      </div>
    </div>
  );
}

function ImageCard({
  image,
  pubDate,
  dispatch,
}: {
  image: import("@/lib/wizard-store").ClientImage;
  pubDate: string;
  dispatch: ReturnType<typeof import("../WizardProvider").useWizard>["dispatch"];
}) {
  const previewPath = previewPathFor(`${image.seoFilename}.webp`);
  void pubDate;

  return (
    <div className="flex gap-4 p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
      {/* Thumbnail */}
      <div className="w-24 h-24 rounded-lg overflow-hidden bg-[var(--border)] shrink-0">
        {image.thumbnailUrl ? (
          <img
            src={image.thumbnailUrl}
            alt={image.originalName}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--muted)] text-xs">
            No preview
          </div>
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm text-[var(--foreground)] truncate">
              {image.originalName}
            </p>
            <p className="text-xs text-[var(--muted)]">
              {image.originalWidth > 0
                ? `${image.originalWidth}x${image.originalHeight}`
                : "..."}{" "}
              &middot; {(image.originalSize / 1024).toFixed(0)} KB
            </p>
          </div>
          {image.processed ? (
            <span className="text-xs px-2 py-0.5 rounded bg-[var(--success)]/20 text-[var(--success)] shrink-0">
              {image.processedWidth}x{image.processedHeight} &middot;{" "}
              {(image.processedSize / 1024).toFixed(0)} KB
            </span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded bg-[var(--border)] text-[var(--muted)] shrink-0">
              Pending
            </span>
          )}
        </div>

        {/* SEO filename input */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-[var(--muted)] block mb-1">
            SEO Filename
            {image.processed && (
              <span className="ml-2 text-[var(--muted)] normal-case tracking-normal">
                · locked (already processed — re-upload to rename)
              </span>
            )}
          </label>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={
                image.processed && image.processedName
                  ? image.processedName.replace(/\.webp$/, "")
                  : image.seoFilename
              }
              readOnly={image.processed}
              onChange={(e) =>
                dispatch({
                  type: "UPDATE_IMAGE",
                  id: image.id,
                  updates: {
                    seoFilename: e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9\-_]/g, ""),
                  },
                })
              }
              className={`flex-1 px-2 py-1 rounded bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] text-xs font-mono focus:outline-none focus:border-[var(--primary)] ${
                image.processed ? "opacity-60 cursor-not-allowed" : ""
              }`}
              placeholder="descriptive-filename"
            />
            <span className="text-xs text-[var(--muted)]">.webp</span>
          </div>
          <p className="text-[10px] text-[var(--muted)] mt-0.5 font-mono truncate">
            {image.processed && image.repoPath ? image.repoPath : previewPath}
          </p>
        </div>

        {/* Crop position picker */}
        <CropPositionPicker
          value={image.cropPosition || "centre"}
          onChange={(pos) =>
            dispatch({
              type: "UPDATE_IMAGE",
              id: image.id,
              updates: { cropPosition: pos },
            })
          }
        />
      </div>
    </div>
  );
}

function CropPositionPicker({
  value,
  onChange,
}: {
  value: CropPosition;
  onChange: (pos: CropPosition) => void;
}) {
  // 3x3 grid maps to Sharp's directional values; centre = middle cell.
  // Diagonals fall back to the nearest cardinal direction Sharp supports.
  const cells: Array<{ pos: CropPosition; label: string }> = [
    { pos: "top", label: "↖" },
    { pos: "top", label: "↑" },
    { pos: "top", label: "↗" },
    { pos: "left", label: "←" },
    { pos: "centre", label: "•" },
    { pos: "right", label: "→" },
    { pos: "bottom", label: "↙" },
    { pos: "bottom", label: "↓" },
    { pos: "bottom", label: "↘" },
  ];

  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-[var(--muted)] block mb-1">
        Crop From
      </label>
      <div className="flex items-center gap-2">
        <div className="grid grid-cols-3 gap-0.5 w-fit">
          {cells.map((cell, i) => {
            const active = value === cell.pos;
            return (
              <button
                key={i}
                type="button"
                onClick={() => onChange(cell.pos)}
                title={cell.pos}
                className={`w-5 h-5 rounded text-[10px] flex items-center justify-center transition-colors ${
                  active
                    ? "bg-[var(--primary)] text-white"
                    : "bg-[var(--border)] text-[var(--muted)] hover:bg-[var(--border)]/70"
                }`}
              >
                {cell.label}
              </button>
            );
          })}
        </div>
        <select
          value={
            (CROP_POSITIONS as readonly string[]).includes(value) ? value : "centre"
          }
          onChange={(e) => onChange(e.target.value as CropPosition)}
          className="px-2 py-1 rounded bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] text-xs focus:outline-none focus:border-[var(--primary)]"
        >
          {CROP_POSITIONS.map((pos) => (
            <option key={pos} value={pos}>
              {pos === "attention"
                ? "Smart (attention)"
                : pos === "entropy"
                  ? "Smart (entropy)"
                  : pos.charAt(0).toUpperCase() + pos.slice(1)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
