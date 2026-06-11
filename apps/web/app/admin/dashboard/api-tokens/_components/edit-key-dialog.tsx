"use client";

import { DialogClose } from "@radix-ui/react-dialog";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const EditKeyDialog = ({
  children,
  id,
}: {
  children: React.ReactNode;
  id: string;
}) => {
  const [keyValue, setKeyValue] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const handleCreateKey = async () => {
    setCreating(true);
    try {
      const res = await fetch(`/api/admin/api-keys/${id}`, {
        method: "PUT",
      });
      console.log("Response from server:", res);
      if (!res.ok) {
        setError("Failed to create API key");
      }
      const data = await res.json();
      setKeyValue(data.apiKey);
    } catch (err) {
      console.error("Failed to create API key:", err);
      setError("Failed to create API key");
    } finally {
      setCreating(false);
    }
  };
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        {!keyValue && (
          <>
            <DialogTitle>Edit API Key</DialogTitle>
            <DialogDescription>
              Use this dialog to edit an existing API key.
            </DialogDescription>
            <Label>Current key</Label>
            <Input value={"dlg24_********************"} readOnly />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <DialogFooter>
              <Button onClick={handleCreateKey} disabled={creating}>
                {creating ? (
                  <>
                    <Loader2 className="animate-spin" /> Generating...
                  </>
                ) : (
                  "Generate new Key"
                )}
              </Button>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
            </DialogFooter>
          </>
        )}
        {keyValue && (
          <>
            <DialogTitle>API Key Generated</DialogTitle>
            <DialogDescription>
              Your new API key is shown below. Please copy it now, as it will
              not be shown again.
            </DialogDescription>
            <Label>API Key</Label>
            <Input className="truncate" value={keyValue} readOnly />
            <DialogFooter>
              <DialogClose asChild>
                <Button
                  onClick={() => {
                    router.refresh();
                  }}
                  variant="outline"
                >
                  Close
                </Button>
              </DialogClose>
              <Button
                onClick={() => {
                  navigator.clipboard.writeText(keyValue);
                }}
              >
                Copy
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
