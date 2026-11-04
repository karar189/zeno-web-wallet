"use client";

import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // A hidden selection can still copy when the async clipboard is blocked.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

export function CopySeedButton({ phrase }: { phrase: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied && !failed) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [copied, failed]);

  async function copy() {
    const text = phrase.trim().replace(/\s+/g, " ");
    const ok = text.length > 0 && (await writeClipboard(text));
    setCopied(ok);
    setFailed(!ok);
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={() => void copy()}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : failed ? "Copy failed" : "Copy seed"}
    </Button>
  );
}
