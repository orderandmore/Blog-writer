"use client";

import { useEffect, useRef, useState } from "react";
import ReactCrop, {
  centerCrop,
  makeAspectCrop,
  type Crop,
  type PercentCrop,
} from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import type { CropRect } from "@/lib/schema";

/**
 * Click-and-drag crop selector for an image. Wraps react-image-crop with the
 * conventions this app uses:
 *
 *   - Aspect ratio is locked (featured = 1200/408 ≈ 2.94, body = 1).
 *   - Crop values are stored as normalized 0..1 fractions in CropRect so
 *     they survive resizing of the displayed image.
 *   - When no value is provided, defaults to a centered crop on first load.
 *   - When `readOnly` is true (e.g. image already processed), the overlay
 *     is shown but not interactive.
 *
 * The selector renders the source image inline so the user sees exactly
 * what slice will be kept.
 */
export function CropSelector({
  src,
  aspect,
  value,
  onChange,
  readOnly = false,
  maxWidth = 380,
}: {
  src: string;
  aspect: number;
  value: CropRect | undefined;
  onChange: (rect: CropRect) => void;
  readOnly?: boolean;
  maxWidth?: number;
}) {
  // react-image-crop uses 0..100 percent units; we translate to/from our
  // 0..1 normalized CropRect at the boundary.
  const [crop, setCrop] = useState<Crop | undefined>(() =>
    value
      ? {
          unit: "%",
          x: value.x * 100,
          y: value.y * 100,
          width: value.width * 100,
          height: value.height * 100,
        }
      : undefined,
  );

  // If the parent passes a new value (e.g. draft hydration after the fact),
  // sync it in.
  const lastValueRef = useRef(value);
  useEffect(() => {
    if (value && value !== lastValueRef.current) {
      setCrop({
        unit: "%",
        x: value.x * 100,
        y: value.y * 100,
        width: value.width * 100,
        height: value.height * 100,
      });
      lastValueRef.current = value;
    }
  }, [value]);

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    if (crop) return; // Respect existing value
    const { naturalWidth, naturalHeight } = e.currentTarget;
    if (!naturalWidth || !naturalHeight) return;

    const initial = centerCrop(
      makeAspectCrop({ unit: "%", width: 90 }, aspect, naturalWidth, naturalHeight),
      naturalWidth,
      naturalHeight,
    );
    setCrop(initial);
    onChange({
      x: initial.x / 100,
      y: initial.y / 100,
      width: initial.width / 100,
      height: initial.height / 100,
    });
  }

  function handleChange(_pixel: Crop, percent: PercentCrop) {
    setCrop({ unit: "%", x: percent.x, y: percent.y, width: percent.width, height: percent.height });
    onChange({
      x: percent.x / 100,
      y: percent.y / 100,
      width: percent.width / 100,
      height: percent.height / 100,
    });
  }

  return (
    <div
      className="rounded-lg overflow-hidden bg-[var(--background)] border border-[var(--border)]"
      style={{ maxWidth }}
    >
      <ReactCrop
        crop={crop}
        onChange={readOnly ? () => {} : handleChange}
        aspect={aspect}
        keepSelection
        ruleOfThirds
        disabled={readOnly}
        className="block"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          onLoad={handleImageLoad}
          alt=""
          className="block max-w-full h-auto select-none"
          draggable={false}
        />
      </ReactCrop>
    </div>
  );
}
