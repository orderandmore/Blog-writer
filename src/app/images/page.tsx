"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CROP_POSITIONS, type CropPosition } from "@/lib/schema";

type Preset =
  | "featured"
  | "body"
  | "social"
  | "social-square"
  | "press"
  | "custom";
type Format = "webp" | "jpeg" | "png";
type Fit = "cover" | "contain" | "inside";

const PRESET_LABELS: Record<Preset, string> = {
  featured: "Featured (800×450 WebP)",
  body: "Body (800×800 WebP)",
  social: "Social wide (1200×630 JPG)",
  "social-square": "Social square (1080×1080 JPG)",
  press: "Press (400×400 JPG)",
  custom: "Custom",
};

const PRESET_DEFAULTS: Record<
  Exclude<Preset, "custom">,
  { width: number; height: number; format: Format; quality: number }
> = {
  featured: { width: 800, height: 450, format: "webp", quality: 85 },
  body: { width: 800, height: 800, format: "webp", quality: 85 },
  social: { width: 1200, height: 630, format: "jpeg", quality: 88 },
  "social-square": { width: 1080, height: 1080, format: "jpeg", quality: 88 },
  press: { width: 400, height: 400, format: "jpeg", quality: 88 },
};

interface SourceInfo {
  name: string;
  width: number;
  height: number;
  size: number;
  previewUrl: string;
}

interface ProcessedResult {
  url: string;
  blob: Blob;
  filename: string;
  width: number;
  height: number;
  size: number;
  mime: string;
}

export default function ImageToolPage() {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<SourceInfo | null>(null);
  const [preset, setPreset] = useState<Preset>("featured");
  const [width, setWidth] = useState(1200);
  const [height, setHeight] = useState(1200);
  const [format, setFormat] = useState<Format>("webp");
  const [quality, setQuality] = useState(85);
  const [fit, setFit] = useState<Fit>("cover");
  const [position, setPosition] = useState<CropPosition>("centre");
  const [filename, setFilename] = useState("image");
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ProcessedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dropRef = useRef<HTMLLabelElement>(null);
  const [dragging, setDragging] = useState(false);

  const effective = useMemo(() => {
    if (preset === "custom") return { width, height, format, quality };
    return PRESET_DEFAULTS[preset];
  }, [preset, width, height, format, quality]);

  useEffect(() => {
    return () => {
      if (source?.previewUrl) URL.revokeObjectURL(source.previewUrl);
    };
  }, [source]);

  useEffect(() => {
    return () => {
      if (result?.url) URL.revokeObjectURL(result.url);
    };
  }, [result]);

  const handleFile = useCallback((picked: File) => {
    if (!picked.type.startsWith("image/")) {
      setError("Not an image file.");
      return;
    }
    setError(null);
    setResult(null);
    setFile(picked);

    const url = URL.createObjectURL(picked);
    const img = new Image();
    img.onload = () => {
      setSource({
        name: picked.name,
        width: img.naturalWidth,
        height: img.naturalHeight,
        size: picked.size,
        previewUrl: url,
      });
      const base = picked.name.replace(/\.[^.]+$/, "");
      setFilename(
        base
          .toLowerCase()
          .replace(/[^a-z0-9\-_]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-+|-+$/g, "") || "image",
      );
    };
    img.onerror = () => {
      setError("Could not read image dimensions.");
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, []);

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (picked) handleFile(picked);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const picked = e.dataTransfer.files?.[0];
    if (picked) handleFile(picked);
  }

  async function process() {
    if (!file) return;
    setProcessing(true);
    setError(null);

    try {
      const fd = new FormData();
      fd.append("image", file);
      fd.append("preset", preset);
      fd.append("position", position);
      fd.append("fit", fit);
      fd.append("filename", filename || "image");
      if (preset === "custom") {
        fd.append("width", String(width));
        fd.append("height", String(height));
        fd.append("format", format);
        fd.append("quality", String(quality));
      }

      const res = await fetch("/api/images/standalone", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(msg.error || "Processing failed");
      }

      const blob = await res.blob();
      const outWidth = Number(res.headers.get("X-Output-Width") || 0);
      const outHeight = Number(res.headers.get("X-Output-Height") || 0);
      const outSize = Number(res.headers.get("X-Output-Size") || blob.size);
      const outName =
        res.headers.get("X-Output-Filename") ||
        `${filename}.${effective.format === "jpeg" ? "jpg" : effective.format}`;

      if (result?.url) URL.revokeObjectURL(result.url);

      setResult({
        url: URL.createObjectURL(blob),
        blob,
        filename: outName,
        width: outWidth,
        height: outHeight,
        size: outSize,
        mime: blob.type,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Processing failed");
    } finally {
      setProcessing(false);
    }
  }

  function downloadResult() {
    if (!result) return;
    const a = document.createElement("a");
    a.href = result.url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function reset() {
    if (source?.previewUrl) URL.revokeObjectURL(source.previewUrl);
    if (result?.url) URL.revokeObjectURL(result.url);
    setFile(null);
    setSource(null);
    setResult(null);
    setError(null);
  }

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <div className="max-w-4xl mx-auto p-8">
        <header className="flex items-baseline justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-white">Image Tool</h1>
            <p className="text-sm text-[var(--muted)] mt-1">
              Standalone crop, resize, rename — no draft, no AI.
            </p>
          </div>
          <Link
            href="/"
            className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            ← Dashboard
          </Link>
        </header>

        {!source && (
          <label
            ref={dropRef}
            htmlFor="image-tool-input"
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`block p-12 rounded-lg border-2 border-dashed text-center cursor-pointer transition-colors ${
              dragging
                ? "border-[var(--primary)] bg-[var(--primary)]/5"
                : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--muted)]"
            }`}
          >
            <p className="text-sm text-[var(--foreground)] mb-1">
              Drop an image here or click to pick
            </p>
            <p className="text-xs text-[var(--muted)]">
              PNG, JPG, WebP, HEIC — any size
            </p>
            <input
              id="image-tool-input"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onFileInput}
            />
          </label>
        )}

        {source && (
          <div className="space-y-6">
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4 p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
              <img
                src={source.previewUrl}
                alt={source.name}
                className="w-20 h-20 object-cover rounded bg-[var(--background)]"
              />
              <div className="min-w-0">
                <p className="text-sm text-[var(--foreground)] truncate">
                  {source.name}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {source.width}×{source.height} ·{" "}
                  {(source.size / 1024).toFixed(0)} KB
                </p>
              </div>
              <button
                onClick={reset}
                className="text-xs text-[var(--muted)] hover:text-[var(--danger)]"
              >
                Replace
              </button>
            </div>

            <section className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-4">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[var(--muted)] block mb-1">
                  Preset
                </label>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPreset(p)}
                      className={`text-xs px-3 py-1.5 rounded ${
                        preset === p
                          ? "bg-[var(--primary)] text-white"
                          : "bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--muted)]"
                      }`}
                    >
                      {PRESET_LABELS[p]}
                    </button>
                  ))}
                </div>
              </div>

              {preset === "custom" && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <LabeledNumber
                    label="Width"
                    value={width}
                    min={16}
                    max={8000}
                    onChange={setWidth}
                  />
                  <LabeledNumber
                    label="Height"
                    value={height}
                    min={16}
                    max={8000}
                    onChange={setHeight}
                  />
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-[var(--muted)] block mb-1">
                      Format
                    </label>
                    <select
                      value={format}
                      onChange={(e) => setFormat(e.target.value as Format)}
                      className="w-full px-2 py-1 rounded bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] text-xs focus:outline-none focus:border-[var(--primary)]"
                    >
                      <option value="webp">WebP</option>
                      <option value="jpeg">JPG</option>
                      <option value="png">PNG</option>
                    </select>
                  </div>
                  <LabeledNumber
                    label="Quality"
                    value={quality}
                    min={1}
                    max={100}
                    onChange={setQuality}
                    disabled={format === "png"}
                  />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-[var(--muted)] block mb-1">
                    Fit
                  </label>
                  <select
                    value={fit}
                    onChange={(e) => setFit(e.target.value as Fit)}
                    className="w-full px-2 py-1 rounded bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] text-xs focus:outline-none focus:border-[var(--primary)]"
                  >
                    <option value="cover">Cover (fill + crop)</option>
                    <option value="contain">Contain (fit + letterbox)</option>
                    <option value="inside">
                      Inside (shrink only, no upscale)
                    </option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-[var(--muted)] block mb-1">
                    Filename
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={filename}
                      onChange={(e) =>
                        setFilename(
                          e.target.value
                            .toLowerCase()
                            .replace(/[^a-z0-9\-_]/g, ""),
                        )
                      }
                      className="flex-1 px-2 py-1 rounded bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] text-xs font-mono focus:outline-none focus:border-[var(--primary)]"
                      placeholder="descriptive-filename"
                    />
                    <span className="text-xs text-[var(--muted)]">
                      .{effective.format === "jpeg" ? "jpg" : effective.format}
                    </span>
                  </div>
                </div>
              </div>

              <CropPositionPicker value={position} onChange={setPosition} />

              <p className="text-[11px] text-[var(--muted)]">
                Output: {effective.width}×{effective.height}{" "}
                {effective.format.toUpperCase()}
                {effective.format !== "png" && ` q${effective.quality}`} · {fit}{" "}
                from {position}
              </p>
            </section>

            <div className="flex items-center gap-3">
              <button
                onClick={process}
                disabled={processing}
                className="px-5 py-2.5 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:bg-[var(--primary-hover)] disabled:opacity-50"
              >
                {processing ? "Processing..." : "Process"}
              </button>
              {error && (
                <p className="text-sm text-[var(--danger)]">{error}</p>
              )}
            </div>

            {result && (
              <section className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                <h2 className="text-sm font-semibold text-white mb-3">
                  Result
                </h2>
                <div className="grid grid-cols-[auto_1fr] gap-4 items-start">
                  <img
                    src={result.url}
                    alt={result.filename}
                    className="max-w-xs max-h-64 object-contain rounded bg-[var(--background)] border border-[var(--border)]"
                  />
                  <div className="space-y-2 text-xs">
                    <p className="font-mono text-[var(--foreground)] break-all">
                      {result.filename}
                    </p>
                    <p className="text-[var(--muted)]">
                      {result.width}×{result.height} ·{" "}
                      {(result.size / 1024).toFixed(1)} KB · {result.mime}
                    </p>
                    <button
                      onClick={downloadResult}
                      className="px-3 py-1.5 rounded bg-[var(--primary)] text-white font-medium hover:bg-[var(--primary-hover)]"
                    >
                      Download
                    </button>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function LabeledNumber({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-[var(--muted)] block mb-1">
        {label}
      </label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n))
            onChange(Math.max(min, Math.min(max, Math.round(n))));
        }}
        className="w-full px-2 py-1 rounded bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] text-xs font-mono focus:outline-none focus:border-[var(--primary)] disabled:opacity-40"
      />
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
            (CROP_POSITIONS as readonly string[]).includes(value)
              ? value
              : "centre"
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
