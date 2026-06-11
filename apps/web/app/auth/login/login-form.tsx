"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, MoveRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export const LoginForm = () => {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (values: LoginFormValues) => {
    const { email, password } = values;
    await authClient.signIn.email(
      {
        email,
        password,
      },
      {
        onRequest: () => {
          setIsLoading(true);
        },
        onSuccess: async (_ctx) => {
          const session = await authClient.getSession();

          if (!session.data?.user || !session.data?.session) {
            setIsLoading(false);
            setError("root", {
              type: "manual",
              message: "Unable to retrieve user session",
            });
            await authClient.signOut();
            return;
          }

          const user = session.data.user;
          const sessionData = session.data.session as any;

          if (!user.emailVerified) {
            setIsLoading(false);
            setError("root", {
              type: "manual",
              message: "Please verify your email address before logging in",
            });
            await authClient.signOut();
            return;
          }

          const userRole = sessionData.role || (user as any).role;
          if (userRole !== "admin") {
            setIsLoading(false);
            setError("root", {
              type: "manual",
              message: "Access denied. Admin privileges required",
            });
            await authClient.signOut();
            return;
          }

          setIsLoading(false);
          router.push("/admin/dashboard");
        },
        onError: (ctx) => {
          console.log(ctx);
          setIsLoading(false);
          setError("root", {
            type: "manual",
            message: ctx.error.message,
          });
        },
      },
    );
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="w-full flex flex-col gap-4 max-w-xl px-4 mx-auto mt-12"
    >
      <Field data-invalid={!!errors.email}>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Controller
          name="email"
          control={control}
          render={({ field }) => (
            <input
              {...field}
              id="email"
              type="email"
              className="w-full px-4 py-2 border-b-2 border-accent focus:outline-none focus:border-b-2 focus:border-foreground transition-colors data-[invalid=true]:border-destructive"
              data-invalid={!!errors.email}
            />
          )}
        />
        {errors.email && <FieldError>{errors.email.message}</FieldError>}
      </Field>

      <Field data-invalid={!!errors.password}>
        <FieldLabel htmlFor="password">Password</FieldLabel>
        <Controller
          name="password"
          control={control}
          render={({ field }) => (
            <input
              {...field}
              id="password"
              type="password"
              className="w-full px-4 py-2 border-b-2 border-accent focus:outline-none focus:border-b-2 focus:border-foreground transition-colors data-[invalid=true]:border-destructive"
              data-invalid={!!errors.password}
            />
          )}
        />
        {errors.password && <FieldError>{errors.password.message}</FieldError>}
      </Field>

      {errors.root && (
        <p className="text-sm text-destructive">{errors.root.message}</p>
      )}

      <Button type="submit" size={"lg"} className="mt-4" disabled={isLoading}>
        {isLoading ? "Logging in..." : "Login"}{" "}
        {isLoading ? <Loader2 className="animate-spin" /> : <MoveRight />}
      </Button>
    </form>
  );
};
