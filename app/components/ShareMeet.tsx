"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { renderShareCardPng } from "@/lib/drawShareCard";
import {
  canUseClipboard,
  meetDeepLink,
  selectBlurbText,
  shareBlurb,
  shareDataFromMeet,
} from "@/lib/shareCard";
import type { MeetPayload } from "@/lib/types";

type Props = {
  meet: MeetPayload;
  /** Compact ghost button for the /play top rail. */
  compact?: boolean;
  className?: string;
};

export default function ShareMeet({ meet, compact, className }: Props) {
  const data = shareDataFromMeet(meet);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [clipboardFallback, setClipboardFallback] = useState(false);
  const blurbRef = useRef<HTMLTextAreaElement>(null);

  const url = meetDeepLink(data.id);
  const blurb = shareBlurb(data, url);

  useEffect(() => {
    if (!open || !clipboardFallback) return;
    selectBlurbText(blurbRef.current);
  }, [open, clipboardFallback, blurb]);

  const openSheet = useCallback(async () => {
    setOpen(true);
    setErr(null);
    setBusy(true);
    setCopied(false);
    setClipboardFallback(!canUseClipboard());
    try {
      const blob = await renderShareCardPng(data, { url });
      const obj = URL.createObjectURL(blob);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return obj;
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not draw the card.");
    } finally {
      setBusy(false);
    }
  }, [data, url]);

  const copyBlurb = useCallback(async () => {
    try {
      if (!canUseClipboard()) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(blurb);
      setCopied(true);
      setClipboardFallback(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setClipboardFallback(true);
      setErr("Clipboard blocked — the blurb is selected. Long-press or tap Copy.");
      selectBlurbText(blurbRef.current);
    }
  }, [blurb]);

  const downloadPng = useCallback(() => {
    if (!previewUrl) return;
    const a = document.createElement("a");
    a.href = previewUrl;
    a.download = `foul-pole-meet-${data.id.slice(0, 8)}.png`;
    a.click();
  }, [previewUrl, data.id]);

  const close = () => {
    setOpen(false);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  return (
    <>
      <button
        type="button"
        className={className ?? (compact ? "ghost" : undefined)}
        style={
          compact
            ? { width: "auto", padding: "8px 10px", minHeight: 36, flex: "none" }
            : undefined
        }
        onClick={() => void openSheet()}
      >
        Share
      </button>
      {open ? (
        <div className="modal-scrim" role="dialog" aria-label="Share meet">
          <div className="modal share-sheet">
            <h2 className="scorefont" style={{ fontSize: 28, margin: "0 0 4px" }}>
              Share this meet
            </h2>
            <p className="sub">Scoreboard card + one-tap blurb. Free for everyone.</p>
            {busy ? <p className="muted">Drawing card…</p> : null}
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="share-preview"
                src={previewUrl}
                alt="Meet share card preview"
                width={216}
                height={384}
              />
            ) : null}
            <label htmlFor="share-blurb">Clipboard blurb</label>
            <textarea
              id="share-blurb"
              ref={blurbRef}
              className="share-blurb"
              readOnly
              rows={4}
              value={blurb}
              data-clipboard-fallback={clipboardFallback ? "true" : "false"}
            />
            {err ? <p className="err">{err}</p> : null}
            {copied ? <p className="ok">Copied.</p> : null}
            <div className="actions">
              <button type="button" className="primary" onClick={() => void copyBlurb()}>
                Copy blurb
              </button>
              <button type="button" disabled={!previewUrl} onClick={downloadPng}>
                Download PNG
              </button>
              <button type="button" className="ghost" onClick={close}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
