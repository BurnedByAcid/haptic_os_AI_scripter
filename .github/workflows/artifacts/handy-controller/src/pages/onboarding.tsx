import { useState, useEffect, useRef } from "react";
import { useAuth, useUser } from "@clerk/react";
import { useLocation, Redirect } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

type UsernameStatus = "idle" | "checking" | "available" | "taken" | "invalid";

export default function OnboardingPage() {
  const { getToken, isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const { user, isLoaded: isUserLoaded } = useUser();
  const [, setLocation] = useLocation();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [firstNameError, setFirstNameError] = useState("");
  const [lastNameError, setLastNameError] = useState("");
  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");
  const [usernameError, setUsernameError] = useState<string>("");
  const [ageVerified, setAgeVerified] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const USERNAME_RE = /^[a-zA-Z0-9_-]+$/;

  function validateLocalUsername(value: string): string | null {
    if (value.length === 0) return null;
    if (value.length < 5) return "Must be at least 5 characters.";
    if (value.length > 32) return "Must be 32 characters or fewer.";
    if (!USERNAME_RE.test(value))
      return "Only letters, numbers, hyphens, and underscores allowed.";
    return null;
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const localError = validateLocalUsername(username);
    if (username.length === 0) {
      setUsernameStatus("idle");
      setUsernameError("");
      return;
    }
    if (localError) {
      setUsernameStatus("invalid");
      setUsernameError(localError);
      return;
    }
    setUsernameStatus("checking");
    setUsernameError("");
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/users/check-username?username=${encodeURIComponent(username)}`,
        );
        if (!res.ok) { setUsernameStatus("invalid"); setUsernameError("Could not check availability."); return; }
        const data = (await res.json()) as { available: boolean };
        setUsernameStatus(data.available ? "available" : "taken");
        setUsernameError(data.available ? "" : "Username is already taken.");
      } catch {
        setUsernameStatus("invalid");
        setUsernameError("Could not check availability.");
      }
    }, 500);
  }, [username]);

  function validateNames(): boolean {
    let valid = true;
    if (!firstName.trim()) {
      setFirstNameError("First name is required.");
      valid = false;
    } else {
      setFirstNameError("");
    }
    if (!lastName.trim()) {
      setLastNameError("Last name is required.");
      valid = false;
    } else {
      setLastNameError("");
    }
    return valid;
  }

  async function handleSubmit() {
    if (!validateNames()) return;
    if (usernameStatus !== "available") return;
    if (!ageVerified) return;

    setSubmitting(true);
    setSubmitError("");
    try {
      await user?.update({ firstName: firstName.trim(), lastName: lastName.trim() });
    } catch {
      setSubmitError("Could not save your name. Please try again.");
      setSubmitting(false);
      return;
    }
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/users/onboard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username, ageVerified }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setSubmitError(data.error ?? "Something went wrong.");
        setSubmitting(false);
        return;
      }
      await user?.reload();
      setLocation("/");
    } catch {
      setSubmitError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  const canSubmit =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    usernameStatus === "available" &&
    ageVerified &&
    !submitting;

  if (!isAuthLoaded || !isUserLoaded) return null;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  if ((user?.publicMetadata as Record<string, unknown>)?.onboarded === true) {
    return <Redirect to="/" />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-[#3D1515] bg-[#120404] p-8 shadow-2xl shadow-[#DC2626]/5 space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-foreground">Welcome to HapticOS</h1>
          <p className="text-sm text-muted-foreground">
            Fill in your details to get started.
          </p>
        </div>

        <div className="space-y-6">
          <div>
            <h2 className="text-base font-semibold text-foreground mb-1">Your Details</h2>
            <p className="text-sm text-muted-foreground">
              Your name is kept private. Your screen name is what others see.
            </p>
          </div>

          {/* First Name */}
          <div className="space-y-2">
            <label htmlFor="firstName" className="text-sm text-muted-foreground">
              First Name
            </label>
            <Input
              id="firstName"
              value={firstName}
              onChange={(e) => {
                setFirstName(e.target.value);
                if (firstNameError && e.target.value.trim()) setFirstNameError("");
              }}
              onBlur={() => {
                if (!firstName.trim()) setFirstNameError("First name is required.");
              }}
              placeholder="Jane"
              maxLength={64}
              className="bg-[#1E0707] border-[#3D1515] focus:border-[#DC2626] focus:ring-[#DC2626]"
              autoComplete="given-name"
              autoFocus
            />
            {firstNameError && (
              <p className="text-xs text-red-400">{firstNameError}</p>
            )}
          </div>

          {/* Last Name */}
          <div className="space-y-2">
            <label htmlFor="lastName" className="text-sm text-muted-foreground">
              Last Name
            </label>
            <Input
              id="lastName"
              value={lastName}
              onChange={(e) => {
                setLastName(e.target.value);
                if (lastNameError && e.target.value.trim()) setLastNameError("");
              }}
              onBlur={() => {
                if (!lastName.trim()) setLastNameError("Last name is required.");
              }}
              placeholder="Doe"
              maxLength={64}
              className="bg-[#1E0707] border-[#3D1515] focus:border-[#DC2626] focus:ring-[#DC2626]"
              autoComplete="family-name"
            />
            {lastNameError && (
              <p className="text-xs text-red-400">{lastNameError}</p>
            )}
          </div>

          {/* Screen Name / Username */}
          <div className="space-y-2">
            <label htmlFor="username" className="text-sm text-muted-foreground">
              Screen Name
            </label>
            <div className="relative">
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                placeholder="e.g. cool_user42"
                maxLength={32}
                className="bg-[#1E0707] border-[#3D1515] pr-9 focus:border-[#DC2626] focus:ring-[#DC2626]"
                autoComplete="off"
                spellCheck={false}
              />
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                {usernameStatus === "checking" && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {usernameStatus === "available" && (
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                )}
                {(usernameStatus === "taken" || usernameStatus === "invalid") &&
                  username.length > 0 && <XCircle className="h-4 w-4 text-red-400" />}
              </div>
            </div>

            {usernameError && (
              <p className="text-xs text-red-400">{usernameError}</p>
            )}
            {usernameStatus === "available" && (
              <p className="text-xs text-green-400">Username is available.</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              5–32 characters. Letters, numbers, hyphens, and underscores only. You can't change it later.
            </p>
          </div>

          {/* Age Confirmation */}
          <label className="flex items-start gap-3 cursor-pointer group">
            <div className="relative mt-0.5 flex-shrink-0">
              <input
                type="checkbox"
                checked={ageVerified}
                onChange={(e) => setAgeVerified(e.target.checked)}
                className="sr-only"
              />
              <div
                className={`h-4 w-4 rounded border transition-colors ${
                  ageVerified
                    ? "bg-[#DC2626] border-[#DC2626]"
                    : "bg-[#1E0707] border-[#3D1515] group-hover:border-[#DC2626]/60"
                } flex items-center justify-center`}
              >
                {ageVerified && (
                  <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 10 10" fill="none">
                    <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            </div>
            <span className="text-sm text-muted-foreground leading-snug select-none">
              I confirm I am 18 years of age or older
            </span>
          </label>

          {submitError && <p className="text-sm text-red-400">{submitError}</p>}

          <Button
            className="w-full bg-[#DC2626] text-white font-bold hover:bg-[#DC2626]/90 disabled:opacity-40"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {submitting ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Setting up…
              </span>
            ) : (
              "Get Started"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
