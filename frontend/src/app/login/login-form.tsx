"use client";

import * as React from "react";
import { AlertCircle, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { ForgotPassword } from "./forgot-password";

/**
 * Interactive sign-in area. Holds the sign-in ⇄ reset toggle so that opening
 * "Forgot your password?" REPLACES the email/password fields instead of stacking
 * a second form beneath them. `loginAction` is the server action from page.tsx.
 */
export function LoginForm({
  loginAction,
  error,
}: {
  loginAction: (formData: FormData) => Promise<void>;
  error?: string;
}) {
  const [reset, setReset] = React.useState(false);

  if (reset) {
    return <ForgotPassword onCancel={() => setReset(false)} />;
  }

  return (
    <>
      <form action={loginAction} className="space-y-4">
        {error && (
          <div className="flex items-center gap-2.5 rounded-md bg-red-50 px-3.5 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-200">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Invalid email or password.
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@calari.com"
            className="h-10"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            name="password"
            required
            autoComplete="current-password"
            className="h-10"
          />
        </div>

        <Button type="submit" className="mt-1 h-10 w-full">
          <Workflow className="h-4 w-4" />
          Sign in to Calari Internal
        </Button>
      </form>

      <button
        type="button"
        onClick={() => setReset(true)}
        className="mt-4 w-full text-center text-sm font-medium text-pink-700 transition-colors hover:text-pink-800"
      >
        Forgot your password?
      </button>
    </>
  );
}
