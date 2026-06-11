"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  CheckCircle2,
  Loader2Icon,
  SendHorizonal,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { StyledLink } from "@/components/styled-link";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { sendToSlack } from "@/lib/send-contact-to-slack";

const contactFormSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.email("Please enter a valid email address"),
  message: z.string().min(10, "Message can't be empty"),
});

type ContactFormData = z.infer<typeof contactFormSchema>;
type StatusType = "idle" | "loading" | "success" | "error";

export const ContactForm = () => {
  const [status, setStatus] = useState<StatusType>("idle");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [ticketId, setTicketId] = useState<string>("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactFormSchema),
  });

  const onSubmit = async (data: ContactFormData) => {
    setStatus("loading");
    setStatusMessage("");
    setTicketId("");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        setStatus("error");
        setStatusMessage(
          result.error ||
            "There was a problem sending your message, try again later.",
        );
        return;
      }

      await sendToSlack({ ...data, ticketId: result.ticketId });

      setStatus("success");
      setStatusMessage("I've gotten your message, thank you!");
      setTicketId(result.ticketId);

      reset();
    } catch (error) {
      console.error("Error submitting form:", error);
      setStatus("error");
      setStatusMessage(
        "There was a problem sending your message, try again later.",
      );
    }
  };

  const handleSendAnother = () => {
    setStatus("idle");
    setStatusMessage("");
    setTicketId("");
  };

  if (status === "success" || status === "error") {
    return (
      <div
        className="w-full min-h-100 flex items-center justify-center"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="text-center space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
          {status === "success" && (
            <>
              <CheckCircle2 className="w-16 h-16 mx-auto text-foreground animate-in zoom-in duration-500" />
              <div className="space-y-3">
                <h3 className="text-2xl font-medium text-foreground">
                  {statusMessage}
                </h3>
                {ticketId && (
                  <p className="text-sm text-foreground/60">
                    Ticket ID:{" "}
                    <span className="font-mono font-semibold text-foreground/80">
                      {ticketId}
                    </span>
                  </p>
                )}
                <p className="text-sm text-foreground/50">
                  You'll receive a confirmation email shortly.
                </p>
              </div>
              <Button
                onClick={handleSendAnother}
                variant="outline"
                className="mt-8"
              >
                Send Another Message
              </Button>
            </>
          )}

          {status === "error" && (
            <>
              <XCircle className="w-16 h-16 mx-auto text-red-600 dark:text-red-400 animate-in zoom-in duration-500" />
              <div className="space-y-3">
                <h3 className="text-2xl font-medium text-foreground">
                  Something went wrong
                </h3>
                <p className="text-sm text-foreground/60 max-w-md mx-auto">
                  {statusMessage}
                </p>
              </div>
              <Button
                onClick={handleSendAnother}
                variant="outline"
                className="mt-8"
              >
                Try Again
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="w-full xs:grid-cols-2 grid-cols-1 grid gap-x-4 gap-y-6 mt-12"
    >
      <Field className="w-full col-span-1 relative">
        <FieldLabel htmlFor="name">Name</FieldLabel>
        <Input id="name" placeholder="Name" {...register("name")} />
        {errors.name && (
          <FieldError className="absolute -bottom-5 left-0 text-left text-xs">
            {errors.name.message}
          </FieldError>
        )}
      </Field>
      <Field className="w-full col-span-1 relative">
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input
          type="email"
          id="email"
          placeholder="Email"
          {...register("email")}
        />
        {errors.email && (
          <FieldError className="absolute -bottom-5 left-0 text-left text-xs">
            {errors.email.message}
          </FieldError>
        )}
      </Field>
      <Field className="w-full col-span-full relative">
        <Textarea
          id="message"
          placeholder="Leave feedback about the site, career opportunities or just to say hello etc."
          className="h-36! resize-none"
          {...register("message")}
        />
        {errors.message && (
          <FieldError className="absolute -bottom-5 left-0 text-left text-xs">
            {errors.message.message}
          </FieldError>
        )}
      </Field>
      <Button
        type="submit"
        className="col-span-full w-full"
        disabled={isSubmitting}
      >
        {isSubmitting ? "Sending..." : "Send Message"}{" "}
        {isSubmitting ? (
          <Loader2Icon className="animate-spin" />
        ) : (
          <SendHorizonal />
        )}
      </Button>
      <p className="-mt-4 text-xs col-span-full text-left wrap-break-word">
        By submitting this form, you agree to the{" "}
        <StyledLink href="/privacy-policy" className="wrap-break-word">
          privacy policy
        </StyledLink>
      </p>
    </form>
  );
};
