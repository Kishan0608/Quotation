"use client";

import { ImageUp, PenLine, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { updateSignature } from "./actions";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_DATA_URL = 380_000;

/**
 * The uploaded picture as a small PNG ready for the documents: the paper (light pixels) becomes
 * transparent, the ink keeps its colour, and the empty margins are cut off.
 */
async function toSignaturePng(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  for (let maxW = 900; maxW >= 300; maxW -= 200) {
    const scale = Math.min(1, maxW / bitmap.width, (maxW / 3) / bitmap.height);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const image = ctx.getImageData(0, 0, w, h);
    const d = image.data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      // Paper fades out; pale strokes keep part of their strength.
      const ink = lum >= 205 ? 0 : lum <= 150 ? 1 : (205 - lum) / 55;
      d[i + 3] = Math.round(d[i + 3] * ink);
      if (d[i + 3] > 24) {
        const p = i / 4, x = p % w, y = (p - x) / w;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) throw new Error("No signature found in that picture. Use a dark pen on white paper.");
    ctx.putImageData(image, 0, 0);
    const pad = 6;
    const cw = Math.min(w, x1 - x0 + 1 + pad * 2);
    const ch = Math.min(h, y1 - y0 + 1 + pad * 2);
    const out = document.createElement("canvas");
    out.width = cw;
    out.height = ch;
    out.getContext("2d")!.drawImage(canvas, Math.max(0, x0 - pad), Math.max(0, y0 - pad), cw, ch, 0, 0, cw, ch);
    const url = out.toDataURL("image/png");
    if (url.length <= MAX_DATA_URL) return url;
  }
  throw new Error("That picture is too detailed. Crop it to just the signature and try again.");
}

/** Company settings: the signature printed above "Authorised Signatory" on quotations. */
export function SignatureCard({ initial }: { initial: string | null }) {
  const [signature, setSignature] = useState(initial);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) return toast.error("Choose a PNG or JPG picture.");
    if (file.size > MAX_FILE_BYTES) return toast.error("That picture is larger than 10 MB.");
    setBusy(true);
    try {
      const png = await toSignaturePng(file);
      const res = await updateSignature(png);
      if (!res.ok) throw new Error(res.error);
      setSignature(png);
      toast.success(res.message);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async () => {
    setBusy(true);
    const res = await updateSignature(null);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setSignature(null);
    toast.success(res.message);
  };

  return (
    <Card>
      <CardHeader icon={<PenLine />} title="Signature" />
      <CardBody className="space-y-4">
        <div className="grid h-36 place-items-center rounded-lg border border-dashed border-slate-300 bg-[repeating-conic-gradient(#f8fafc_0%_25%,#ffffff_0%_50%)] bg-[length:16px_16px] p-3">
          {signature ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing for next/image to optimise
            <img src={signature} alt="Your signature" className="max-h-full max-w-full object-contain" />
          ) : (
            <p className="text-sm text-slate-400">No signature yet</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button type="button" variant="outline" onClick={() => input.current?.click()} loading={busy}>
            {!busy ? <ImageUp /> : null} {signature ? "Change signature" : "Upload signature"}
          </Button>
          {signature ? (
            <Button type="button" variant="ghost" onClick={remove} disabled={busy} className="hover:bg-red-50 hover:text-red-600">
              <Trash2 /> Remove
            </Button>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
