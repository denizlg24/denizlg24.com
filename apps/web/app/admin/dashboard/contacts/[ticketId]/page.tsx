import { ArrowLeft, Clock, Mail, MapPin, User } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getContactByTicketId } from "@/lib/contacts";
import { DeleteContactButton } from "./delete-contact-button";
import { MarkAsRead } from "./mark-as-read";

export const metadata: Metadata = {
  title: "Contact Details | Admin Dashboard",
};

export const dynamic = "force-dynamic";

export default async function ContactDetailsPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const { ticketId } = await params;
  const contact = await getContactByTicketId(ticketId);

  if (!contact) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <MarkAsRead ticketId={contact.ticketId} currentStatus={contact.status} />
      <div className="flex flex-col items-start gap-1">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/dashboard/contacts">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Link>
        </Button>

        <div>
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">
            Contact details
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Ticket #{contact.ticketId}
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 border-0 shadow-none gap-4">
          <div className="border-b pb-4">
            <h2 className="text-base sm:text-lg font-semibold mb-4">
              Contact Information
            </h2>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <User className="w-4 h-4 text-muted-foreground" />
                <div>
                  <div className="text-xs sm:text-sm text-muted-foreground">
                    Name
                  </div>
                  <div className="text-sm sm:text-base font-medium">
                    {contact.name}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <div>
                  <div className="text-sm text-muted-foreground">Email</div>
                  <a
                    href={`mailto:${contact.email}`}
                    className="font-medium hover:underline"
                  >
                    {contact.email}
                  </a>
                </div>
              </div>
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-4">Message</h2>
            <p className="text-muted-foreground whitespace-pre-wrap">
              {contact.message}
            </p>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-4 space-y-4">
            <div>
              <div className="text-sm text-muted-foreground mb-1">Status</div>
              <Badge
                variant={
                  contact.status === "pending"
                    ? "default"
                    : contact.status === "read"
                      ? "secondary"
                      : contact.status === "responded"
                        ? "default"
                        : "secondary"
                }
              >
                {contact.status}
              </Badge>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">
                Email Status
              </div>
              {contact.emailSent ? (
                <Badge variant="default">✓ Sent</Badge>
              ) : (
                <Badge variant="secondary">Pending</Badge>
              )}
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">
                Submitted
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Clock className="w-4 h-4" />
                {new Date(contact.createdAt).toLocaleString()}
              </div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">
                IP Address
              </div>
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="w-4 h-4" />
                <code className="bg-muted px-2 py-1 rounded text-xs">
                  {contact.ipAddress}
                </code>
              </div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground mb-1">
                User Agent
              </div>
              <div className="text-xs text-muted-foreground break-all">
                {contact.userAgent}
              </div>
            </div>
          </Card>

          <Card className="p-4 gap-1">
            <h3 className="font-semibold mb-2">Actions</h3>
            <Button className="w-full" asChild>
              <a href={`mailto:${contact.email}`}>Reply via Email</a>
            </Button>
            <DeleteContactButton ticketId={contact.ticketId} />
          </Card>
        </div>
      </div>
    </div>
  );
}
