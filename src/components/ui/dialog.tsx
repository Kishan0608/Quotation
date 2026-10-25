"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  variant?: "center" | "drawer";
  /** Prevent closing with Esc / backdrop (e.g. while saving). */
  locked?: boolean;
};

const SIZES = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl", "2xl": "max-w-6xl" };

export function Modal({ open, onClose, title, description, children, footer, size = "md", variant = "center", locked }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      document.documentElement.style.overflow = "hidden";
    } else if (!open && dialog.open) {
      dialog.close();
    }
    return () => {
      if (open) document.documentElement.style.overflow = "";
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!locked) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !locked) onClose();
      }}
      className={cn(
        "bg-transparent p-0 text-slate-900 backdrop:animate-fade-in open:flex",
        variant === "drawer"
          ? "m-0 ml-auto h-dvh max-h-dvh w-full max-w-none sm:max-w-xl"
          : cn("m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)]", SIZES[size]),
      )}
    >
      {open ? (
        <div
          className={cn(
            "flex w-full flex-col overflow-hidden bg-white shadow-pop",
            variant === "drawer" ? "h-full animate-slide-in-right" : "max-h-[calc(100dvh-2rem)] animate-scale-in rounded-xl",
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900">{title}</h2>
              {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose} disabled={locked} aria-label="Close">
              <X />
            </Button>
          </header>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3">{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  );
}

type ConfirmProps = {
  open: boolean;
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", tone = "danger", loading, onConfirm, onClose }: ConfirmProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      locked={loading}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-slate-600">{message}</div>
    </Modal>
  );
}
