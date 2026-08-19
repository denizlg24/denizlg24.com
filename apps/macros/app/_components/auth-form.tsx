"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { ArrowRight, LoaderCircle, MailOpen } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"

type AuthMode = "login" | "signup"

const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
})

const signupSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  terms: z.boolean().refine((v) => v === true, {
    message: "You must accept the terms and conditions",
  }),
})

type LoginValues = z.infer<typeof loginSchema>
type SignupValues = z.infer<typeof signupSchema>

export function AuthForm() {
  const [mode, setMode] = useState<AuthMode>("login")

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">
          {mode === "login" ? "Welcome back" : "Create account"}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {mode === "login"
            ? "Sign in to your food log, recipes, and weight trend."
            : "Track your nutrition. Email verification required before sign-in."}
        </p>
      </div>

      <div className="mb-5 flex gap-5 border-b">
        {(["login", "signup"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setMode(item)}
            className={cn(
              "relative pb-3 text-sm font-medium text-muted-foreground transition-colors",
              mode === item && "text-foreground"
            )}
          >
            {item === "login" ? "Log in" : "Sign up"}
            {mode === item && (
              <span className="absolute inset-x-0 -bottom-px h-px bg-foreground" />
            )}
          </button>
        ))}
      </div>

      {mode === "login" ? <LoginForm /> : <SignupForm />}
    </div>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-xs text-destructive">{message}</p>
}

function LoginForm() {
  const [serverMessage, setServerMessage] = useState("")
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) })

  async function onSubmit(values: LoginValues) {
    setServerMessage("")
    const response = await authClient.signIn.email({
      email: values.email,
      password: values.password,
      callbackURL: "/",
    })
    if (response.error) {
      setServerMessage(response.error.message ?? "Something went wrong.")
      return
    }
    setServerMessage("Signed in.")
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="login-email">Email</Label>
        <Input
          id="login-email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          aria-invalid={!!errors.email}
          {...register("email")}
        />
        <FieldError message={errors.email?.message} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="login-password">Password</Label>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          aria-invalid={!!errors.password}
          {...register("password")}
        />
        <FieldError message={errors.password?.message} />
      </div>

      <div className="pt-1">
        <Button
          className="h-12 w-full justify-between rounded-none border-0 bg-primary px-0 pl-4 pr-3 text-base text-primary-foreground hover:bg-primary/85"
          disabled={isSubmitting}
          size="lg"
          type="submit"
        >
          <span>Enter Macros</span>
          {isSubmitting ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <ArrowRight />
          )}
        </Button>
      </div>

      {serverMessage && (
        <p
          aria-live="polite"
          className="text-center text-sm text-muted-foreground"
        >
          {serverMessage}
        </p>
      )}
    </form>
  )
}

function SignupForm() {
  const [error, setError] = useState("")
  const [sentTo, setSentTo] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { terms: false },
  })

  const termsChecked = watch("terms")

  async function onSubmit(values: SignupValues) {
    setError("")
    const response = await authClient.signUp.email({
      email: values.email,
      password: values.password,
      name: values.name,
      callbackURL: "/register/complete",
    })
    if (response.error) {
      setError(response.error.message ?? "Something went wrong.")
      return
    }
    setSentTo(values.email)
  }

  if (sentTo) {
    return (
      <div className="animate-in fade-in slide-in-from-bottom-3 duration-300 space-y-4 pt-2">
        <div className="flex size-11 items-center justify-center rounded-full bg-muted">
          <MailOpen className="size-5 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-base font-semibold">Check your inbox</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            We sent a verification link to{" "}
            <span className="font-medium text-foreground">{sentTo}</span>. Open
            it to activate your account before signing in.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Didn&apos;t get it? Check your spam folder.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="signup-name">Name</Label>
        <Input
          id="signup-name"
          autoComplete="name"
          placeholder="Deniz"
          aria-invalid={!!errors.name}
          {...register("name")}
        />
        <FieldError message={errors.name?.message} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="signup-email">Email</Label>
        <Input
          id="signup-email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          aria-invalid={!!errors.email}
          {...register("email")}
        />
        <FieldError message={errors.email?.message} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="signup-password">Password</Label>
        <Input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          aria-invalid={!!errors.password}
          {...register("password")}
        />
        <FieldError message={errors.password?.message} />
      </div>

      <div className="space-y-1.5 pt-1">
        <div className="flex items-start gap-3">
          <Checkbox
            id="signup-terms"
            className="mt-0.5"
            checked={termsChecked}
            onCheckedChange={(checked) =>
              setValue("terms", checked === true, { shouldValidate: true })
            }
            aria-invalid={!!errors.terms}
          />
          <Label
            htmlFor="signup-terms"
            className="flex flex-row flex-wrap gap-1 text-sm font-normal leading-snug text-muted-foreground"
          >
            I agree to the{" "}
            <a
              href="/terms"
              className="inline-flex text-foreground underline underline-offset-2"
            >
              terms and conditions
            </a>{" "}
            and{" "}
            <a
              href="/privacy"
              className="inline-flex text-foreground underline underline-offset-2"
            >
              privacy policy
            </a>
          </Label>
        </div>
        <FieldError message={errors.terms?.message} />
      </div>

      <div className="pt-1">
        <Button
          className="h-12 w-full justify-between rounded-none border-0 bg-primary px-0 pl-4 pr-3 text-base text-primary-foreground hover:bg-primary/85"
          disabled={isSubmitting}
          size="lg"
          type="submit"
        >
          <span>Create account</span>
          {isSubmitting ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <ArrowRight />
          )}
        </Button>
      </div>

      {error && (
        <p aria-live="polite" className="text-center text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
