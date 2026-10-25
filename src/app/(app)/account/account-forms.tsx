"use client";

import { KeyRound, UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { changePassword, updateProfileName } from "./actions";

export function AccountForms({ fullName, resetMode }: { fullName: string; resetMode: boolean }) {
  const [name, setName] = useState(fullName);
  const [savingName, setSavingName] = useState(false);
  const [pw, setPw] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});
  const [savingPw, setSavingPw] = useState(false);

  const saveName = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSavingName(true);
    const res = await updateProfileName({ full_name: name });
    setSavingName(false);
    if (res.ok) toast.success(res.message);
    else toast.error(res.error);
  };

  const savePassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSavingPw(true);
    setPwErrors({});
    const res = await changePassword({ ...pw, current_password: pw.current_password || undefined });
    setSavingPw(false);
    if (res.ok) {
      toast.success(res.message);
      setPw({ current_password: "", new_password: "", confirm_password: "" });
    } else {
      setPwErrors(res.fieldErrors ?? {});
      toast.error(res.error);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="h-fit">
        <CardHeader icon={<UserRound />} title="Profile" />
        <CardBody>
          <form onSubmit={saveName} className="space-y-4">
            <Field label="Full name" htmlFor="a-name">
              <Input id="a-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" />
            </Field>
            <Button type="submit" loading={savingName}>
              Save name
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card className={resetMode ? "ring-2 ring-brand-400" : undefined}>
        <CardHeader icon={<KeyRound />} title={resetMode ? "Set a new password" : "Change password"} description="Min. 10 characters, with letters and numbers." />
        <CardBody>
          <form onSubmit={savePassword} className="space-y-4">
            {!resetMode || pwErrors.current_password ? (
              <Field label="Current password" htmlFor="a-cur" error={pwErrors.current_password}>
                <Input id="a-cur" type="password" autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
              </Field>
            ) : null}
            <Field label="New password" htmlFor="a-new" error={pwErrors.new_password}>
              <Input id="a-new" type="password" autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
            </Field>
            <Field label="Confirm new password" htmlFor="a-conf" error={pwErrors.confirm_password}>
              <Input id="a-conf" type="password" autoComplete="new-password" value={pw.confirm_password} onChange={(e) => setPw({ ...pw, confirm_password: e.target.value })} />
            </Field>
            <Button type="submit" loading={savingPw}>
              Update password
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
