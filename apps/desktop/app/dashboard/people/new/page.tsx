"use client";

import { Page } from "@repo/ui/page";
import { UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PersonDetail } from "@/app/dashboard/people/_components/person-detail";
import { DashboardPageHeader } from "@/components/navigation/dashboard-page-header";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type {
  IPerson,
  IPersonEdge,
  IPersonGraph,
  IPersonGroup,
} from "@/lib/data-types";

function createDraftPerson(): IPerson {
  const now = new Date().toISOString();
  return {
    _id: "draft",
    name: "",
    birthday: null,
    placeMet: "",
    notes: "",
    photos: [],
    groupIds: [],
    socials: [],
    createdAt: now,
    updatedAt: now,
  };
}

export default function NewPersonPage() {
  const router = useRouter();
  const { settings, loading: loadingSettings } = useUserSettings();
  const api = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi();
  }, [settings, loadingSettings]);

  // Stable identity: PersonDetail resets its fields whenever `person` changes,
  // so a fresh draft per render would wipe what was typed on every re-render.
  const [draft] = useState(createDraftPerson);
  const [people, setPeople] = useState<IPerson[]>([]);
  const [groups, setGroups] = useState<IPersonGroup[]>([]);
  const [edges, setEdges] = useState<IPersonEdge[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!api) return;
    api.GET<IPersonGraph>({ endpoint: "people" }).then((result) => {
      if ("code" in result) return;
      setPeople(result.people);
      setGroups(result.groups);
      setEdges(result.edges);
    });
  }, [api]);

  const createPerson = async (body: Record<string, unknown>) => {
    if (!api || saving) return null;
    setSaving(true);
    const result = await api.POST<{ person: IPerson }>({
      endpoint: "people",
      body,
    });
    setSaving(false);
    if ("code" in result) {
      toast.error(result.message);
      return null;
    }
    toast.success("Created");
    router.push(`/dashboard/people?person=${result.person._id}`);
    return result.person;
  };

  const createGroup = async (name: string) => {
    if (!api) return null;
    const result = await api.POST<{ group: IPersonGroup }>({
      endpoint: "people/groups",
      body: { name },
    });
    if ("code" in result) {
      toast.error(result.message);
      return null;
    }
    setGroups((current) =>
      [...current, result.group].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    );
    return result.group;
  };

  return (
    <Page>
      <DashboardPageHeader
        icon={<UserPlus />}
        title="New person"
        crumbs={[
          { label: "People", onClick: () => router.push("/dashboard/people") },
        ]}
      />
      <PersonDetail
        person={draft}
        people={people}
        groups={groups}
        edges={edges}
        api={api}
        mode="draft"
        saving={saving}
        onCreateGroup={createGroup}
        onSave={createPerson}
      />
    </Page>
  );
}
