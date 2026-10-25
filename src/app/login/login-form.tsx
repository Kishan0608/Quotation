"use client";

import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { requestPasswordReset, signIn, type AuthFormState } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [showPassword, setShowPassword] = useState(false);
  const [signInState, signInAction, signingIn] = useActionState<AuthFormState, FormData>(signIn, {});
  const [resetState, resetAction, resetting] = useActionState<AuthFormState, FormData>(requestPasswordReset, {});

  if (mode === "reset") {
    return (
      <form action={resetAction} className="mt-7 space-y-4" noValidate>
        <p className="text-sm text-slate-600">We&apos;ll email you a reset link.</p>
        <Field label="Email" htmlFor="reset-email">
          <div className="relative">
            <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input id="reset-email" name="email" type="email" autoComplete="email" required className="h-10 pl-9" placeholder="you@company.com" />
          </div>
        </Field>
        {resetState.error ? <p className="text-sm text-red-600" role="alert">{resetState.error}</p> : null}
        {resetState.message ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{resetState.message}</p> : null}
        <Button type="submit" size="lg" className="w-full" loading={resetting}>
          Send reset link
        </Button>
        <button type="button" onClick={() => setMode("signin")} className="w-full text-center text-sm font-medium text-brand-700 hover:text-brand-800">
          Back to sign in
        </button>
      </form>
    );
  }

  return (
    <form action={signInAction} className="mt-7 space-y-4" noValidate>
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" htmlFor="email">
        <div className="relative">
          <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            defaultValue={signInState.email}
            className="h-10 pl-9"
            placeholder="you@company.com"
            aria-invalid={Boolean(signInState.error) || undefined}
          />
        </div>
      </Field>
      <Field
        label={
          <span className="flex items-center justify-between">
            Password
            <button type="button" onClick={() => setMode("reset")} className="text-xs font-medium text-brand-700 hover:text-brand-800">
              Forgot password?
            </button>
          </span>
        }
        htmlFor="password"
      >
        <div className="relative">
          <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            className="h-10 pr-10 pl-9"
            placeholder="••••••••"
            aria-invalid={Boolean(signInState.error) || undefined}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Field>
      {signInState.error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {signInState.error}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="w-full" loading={signingIn}>
        Sign in
      </Button>
    </form>
  );
}
