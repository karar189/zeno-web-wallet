"use client";

import { useEffect, useState, type RefObject } from "react";

type QrSymbol = {
  modules: {
    size: number;
    get: (row: number, col: number) => number;
  };
};

type QrModule = {
  create: (text: string, options: { errorCorrectionLevel: "H" }) => QrSymbol;
};

const DEFAULT_SIZE = 280;

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function paint(canvas: HTMLCanvasElement, symbol: QrSymbol, size: number) {
  const count = symbol.modules.size;
  const quiet = 2;
  const cells = count + quiet * 2;
  const cell = size / cells;
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const scale = 2;
  canvas.width = size * scale;
  canvas.height = size * scale;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.fillStyle = "#000000";
  context.fillRect(0, 0, size, size);
  context.fillStyle = "#FFFFFF";

  const finderAt = (row: number, col: number) =>
    (row < 7 && col < 7) ||
    (row < 7 && col >= count - 7) ||
    (row >= count - 7 && col < 7);

  const center = count / 2;
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (!symbol.modules.get(row, col) || finderAt(row, col)) {
        continue;
      }
      if (Math.abs(row + 0.5 - center) < 4.2 && Math.abs(col + 0.5 - center) < 4.2) {
        continue;
      }
      context.beginPath();
      context.arc((col + quiet + 0.5) * cell, (row + quiet + 0.5) * cell, cell * 0.34, 0, Math.PI * 2);
      context.fill();
    }
  }

  const drawFinder = (row: number, col: number) => {
    const x = (col + quiet) * cell;
    const y = (row + quiet) * cell;
    context.fillStyle = "#FFFFFF";
    roundRect(context, x, y, cell * 7, cell * 7, cell * 1.5);
    context.fill();
    context.fillStyle = "#000000";
    roundRect(context, x + cell, y + cell, cell * 5, cell * 5, cell * 0.9);
    context.fill();
    context.fillStyle = "#FFFFFF";
    roundRect(context, x + cell * 2, y + cell * 2, cell * 3, cell * 3, cell * 0.65);
    context.fill();
  };

  drawFinder(0, 0);
  drawFinder(0, count - 7);
  drawFinder(count - 7, 0);
}

export function PaymentQr({
  value,
  canvasRef,
  size = DEFAULT_SIZE,
}: {
  value: string;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const display = Math.round(size * 0.86);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    void import("qrcode")
      .then((qr) => {
        if (cancelled) {
          return;
        }
        const symbol = (qr as unknown as QrModule).create(value, { errorCorrectionLevel: "H" });
        paint(canvas, symbol, size);
        const image = new Image();
        image.onload = () => {
          if (cancelled) {
            return;
          }
          const context = canvas.getContext("2d");
          if (!context) {
            return;
          }
          const badge = Math.max(36, Math.round(size * 0.186));
          const x = (size - badge) / 2;
          const y = (size - badge) / 2;
          context.setTransform(2, 0, 0, 2, 0, 0);
          context.fillStyle = "#14120C";
          roundRect(context, x, y, badge, badge, Math.round(badge * 0.27));
          context.fill();
          context.save();
          roundRect(context, x + 6, y + 6, badge - 12, badge - 12, 999);
          context.clip();
          context.drawImage(image, x + 6, y + 6, badge - 12, badge - 12);
          context.restore();
        };
        image.src = "/logos/zcash-coingecko.png";
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canvasRef, size, value]);

  if (failed) {
    return <p className="text-center text-sm text-[#8B928E]">QR code could not be created.</p>;
  }

  return (
    <canvas
      ref={canvasRef}
      aria-label="QR code for this Zcash address"
      style={{ width: display, height: display }}
      className="mx-auto"
    />
  );
}
