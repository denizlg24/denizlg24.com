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

const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain at least one uppercase letter, one lowercase letter, and one number",
    ),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export const RegisterForm = () => {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
    },
  });

  const onSubmit = async (values: RegisterFormValues) => {
    const { email, password, name } = values;
    await authClient.signUp.email(
      {
        email,
        password,
        name,
      },
      {
        onRequest: () => {
          setIsLoading(true);
        },
        onSuccess: () => {
          setIsLoading(false);
          router.push("/auth/login");
        },
        onError: (ctx) => {
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
      <Field data-invalid={!!errors.name}>
        <FieldLabel htmlFor="name">Name</FieldLabel>
        <Controller
          name="name"
          control={control}
          render={({ field }) => (
            <input
              {...field}
              id="name"
              type="text"
              className="w-full px-4 py-2 border-b-2 border-accent focus:outline-none focus:border-b-2 focus:border-foreground transition-colors data-[invalid=true]:border-destructive"
              data-invalid={!!errors.name}
            />
          )}
        />
        {errors.name && <FieldError>{errors.name.message}</FieldError>}
      </Field>

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
        {isLoading ? "Registering..." : "Register"}{" "}
        {isLoading ? <Loader2 className="animate-spin" /> : <MoveRight />}
      </Button>
    </form>
  );
};
