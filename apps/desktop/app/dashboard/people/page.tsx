"use client";

import {
  FolderPlus,
  FolderTree,
  LayoutGrid,
  List,
  Loader2,
  RefreshCcw,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { GroupTreeCombobox } from "@/app/dashboard/notes/_components/group-tree-combobox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type {
  IPerson,
  IPersonEdge,
  IPersonGraph,
  IPersonGroup,
} from "@/lib/data-types";
import { buildDescendantIdMap, buildPathLabelMap } from "@/lib/note-group-tree";
import { PersonDetail } from "./_components/person-detail";
import { PersonGraph } from "./_components/person-graph";
import { PersonGroupDetail } from "./_components/person-group-detail";
import { PersonList } from "./_components/person-list";

type View = "graph" | "list";

function matchesQuery(person: IPerson, query: string, groupLabels: string[]) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [person.name, person.placeMet, person.notes, ...groupLabels]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(normalized));
}

function collectVisibleGroups(people: IPerson[], groups: IPersonGroup[]) {
  const byId = new Map(groups.map((group) => [group._id, group]));
  const visible = new Set<string>();

  for (const person of people) {
    for (const groupId of person.groupIds) {
      let currentId: string | null | undefined = groupId;
      while (currentId) {
        if (visible.has(currentId)) break;
        visible.add(currentId);
        currentId = byId.get(currentId)?.parentId ?? null;
      }
    }
  }

  return groups.filter((group) => visible.has(group._id));
}

export default function PeoplePage() {
  const router = useRouter();
  const { settings, loading: loadingSettings } = useUserSettings();
  const api = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi(settings.apiKey);
  }, [settings, loadingSettings]);

  const [view, setView] = useState<View>("graph");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [people, setPeople] = useState<IPerson[]>([]);
  const [groups, setGroups] = useState<IPersonGroup[]>([]);
  const [edges, setEdges] = useState<IPersonEdge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedGroupFilters, setSelectedGroupFilters] = useState<string[]>(
    [],
  );
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");

  const load = useCallback(
    async (silent = false) => {
      if (!api) return;
      if (silent) setRefreshing(true);
      else setLoading(true);

      const result = await api.GET<IPersonGraph>({ endpoint: "people" });
      if ("code" in result) {
        toast.error(result.message);
      } else {
        setPeople(result.people);
        setGroups(result.groups);
        setEdges(result.edges);
      }

      if (silent) setRefreshing(false);
      else setLoading(false);
    },
    [api],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const pathLabelById = useMemo(() => buildPathLabelMap(groups), [groups]);
  const descendantIdsByGroup = useMemo(
    () => buildDescendantIdMap(groups),
    [groups],
  );
  const selectedGroupScope = useMemo(() => {
    const next = new Set<string>();
    for (const groupId of selectedGroupFilters) {
      for (const scopedId of descendantIdsByGroup.get(groupId) ?? [groupId]) {
        next.add(scopedId);
      }
    }
    return next;
  }, [descendantIdsByGroup, selectedGroupFilters]);

  const filteredPeople = useMemo(
    () =>
      people.filter((person) => {
        const labels = person.groupIds
          .map((groupId) => pathLabelById.get(groupId))
          .filter((label): label is string => Boolean(label));
        if (!matchesQuery(person, query, labels)) return false;
        if (
          selectedGroupScope.size > 0 &&
          !person.groupIds.some((groupId) => selectedGroupScope.has(groupId))
        ) {
          return false;
        }
        return true;
      }),
    [pathLabelById, people, query, selectedGroupScope],
  );

  const sortedPeople = useMemo(
    () =>
      [...filteredPeople].sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime(),
      ),
    [filteredPeople],
  );
  const graphGroups = useMemo(
    () => collectVisibleGroups(sortedPeople, groups),
    [groups, sortedPeople],
  );
  const graphEdges = useMemo(() => {
    const visibleIds = new Set(sortedPeople.map((person) => person._id));
    return edges.filter(
      (edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to),
    );
  }, [edges, sortedPeople]);
  const selectedPerson = useMemo(
    () => people.find((person) => person._id === selectedId) ?? null,
    [people, selectedId],
  );
  const selectedGroup = useMemo(
    () => groups.find((group) => group._id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  const savePerson = async (id: string, body: Record<string, unknown>) => {
    if (!api) return null;
    const result = await api.PATCH<{ person: IPerson }>({
      endpoint: `people/${id}`,
      body,
    });
    if ("code" in result) {
      toast.error(result.message);
      return null;
    }
    setPeople((current) =>
      current.map((person) => (person._id === id ? result.person : person)),
    );
    toast.success("Person saved");
    await load(true);
    return result.person;
  };

  const deletePerson = async (id: string) => {
    if (!api) return;
    const result = await api.DELETE<{ success: true }>({
      endpoint: `people/${id}`,
    });
    if ("code" in result) {
      toast.error(result.message);
      return;
    }
    setSelectedId(null);
    setPeople((current) => current.filter((person) => person._id !== id));
    setEdges((current) =>
      current.filter((edge) => edge.from !== id && edge.to !== id),
    );
    toast.success("Person deleted");
  };

  const createPersonGroup = async (name: string, description?: string) => {
    if (!api || !name.trim()) return null;
    const result = await api.POST<{ group: IPersonGroup }>({
      endpoint: "people/groups",
      body: {
        name: name.trim(),
        description: description?.trim() || undefined,
      },
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

  const createGroup = async () => {
    const group = await createPersonGroup(groupName, groupDescription);
    if (!group) return;
    setCreatingGroup(false);
    setGroupName("");
    setGroupDescription("");
  };

  const updateGroup = async (id: string, patch: Partial<IPersonGroup>) => {
    if (!api) return;
    const result = await api.PATCH<{ group: IPersonGroup }>({
      endpoint: `people/groups/${id}`,
      body: patch,
    });
    if ("code" in result) {
      toast.error(result.message);
      return;
    }
    setGroups((current) =>
      current.map((group) => (group._id === id ? result.group : group)),
    );
    if (patch.parentId !== undefined) await load(true);
  };

  const deleteGroup = async (id: string) => {
    if (!api) return;
    const result = await api.DELETE<{ success: true }>({
      endpoint: `people/groups/${id}`,
    });
    if ("code" in result) {
      toast.error(result.message);
      return;
    }
    setSelectedGroupId(null);
    await load(true);
  };

  if (loading) return <PeopleLoadingSkeleton />;

  if (selectedPerson) {
    return (
      <PersonDetail
        person={selectedPerson}
        people={people}
        groups={groups}
        edges={edges}
        api={api}
        onCreateGroup={(name) => createPersonGroup(name)}
        onBack={() => setSelectedId(null)}
        onSave={(body) => savePerson(selectedPerson._id, body)}
        onDelete={() => deletePerson(selectedPerson._id)}
      />
    );
  }

  if (selectedGroup) {
    return (
      <PersonGroupDetail
        group={selectedGroup}
        groups={groups}
        people={people}
        onBack={() => setSelectedGroupId(null)}
        onUpdate={updateGroup}
        onDelete={deleteGroup}
        onSelectPerson={(person) => {
          setSelectedGroupId(null);
          setSelectedId(person._id);
        }}
      />
    );
  }

  const hasActiveFilters =
    query.trim().length > 0 || selectedGroupFilters.length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <UsersRound className="size-4" />
          <h1 className="text-sm font-medium">People</h1>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {sortedPeople.length} / {people.length} · {groups.length} groups
          </span>
        </div>
        <div className="ml-2 flex grow items-center gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, notes, place…"
            className="h-7 w-full! max-w-full! text-xs"
          />
          <Tabs value={view} onValueChange={(value) => setView(value as View)}>
            <TabsList className="h-7!">
              <TabsTrigger value="graph" className="h-5.5 px-2 text-xs">
                <LayoutGrid className="size-3.5" />
              </TabsTrigger>
              <TabsTrigger value="list" className="h-5.5 px-2 text-xs">
                <List className="size-3.5" />
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => void load(true)}
          >
            {refreshing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCcw className="size-3.5" />
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => setCreatingGroup(true)}
          >
            <FolderPlus className="size-3.5" />
            Group
          </Button>
          <Button
            size="sm"
            className="h-7"
            onClick={() => router.push("/dashboard/people/new")}
          >
            <UserPlus className="size-3.5" />
            Person
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <span className="flex shrink-0 items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          <FolderTree className="size-3.5" />
        </span>
        <GroupTreeCombobox
          groups={groups}
          value={selectedGroupFilters}
          onChange={setSelectedGroupFilters}
          placeholder="Filter groups…"
          searchPlaceholder="Search group hierarchy…"
          emptyMessage="No groups yet"
        />
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2 text-xs"
            onClick={() => {
              setQuery("");
              setSelectedGroupFilters([]);
            }}
          >
            <X className="size-3.5" />
            Clear
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        {view === "graph" ? (
          <PersonGraph
            people={sortedPeople}
            groups={graphGroups}
            edges={graphEdges}
            onSelectPerson={(person) => {
              setSelectedGroupId(null);
              setSelectedId(person._id);
            }}
            onSelectGroup={(group) => {
              setSelectedId(null);
              setSelectedGroupId(group._id);
            }}
          />
        ) : (
          <PersonList
            people={sortedPeople}
            groups={groups}
            onSelect={(person) => {
              setSelectedGroupId(null);
              setSelectedId(person._id);
            }}
            onSelectGroup={(group) => {
              setSelectedId(null);
              setSelectedGroupId(group._id);
            }}
          />
        )}
      </div>

      <Dialog open={creatingGroup} onOpenChange={setCreatingGroup}>
        <DialogContent className="max-w-md">
          <DialogTitle>New people group</DialogTitle>
          <DialogDescription className="sr-only">
            Create a group for people.
          </DialogDescription>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea
                value={groupDescription}
                onChange={(event) => setGroupDescription(event.target.value)}
              />
            </div>
          </div>
          <Button size="sm" onClick={createGroup} disabled={!groupName.trim()}>
            Create
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PeopleLoadingSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <UsersRound className="size-4" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-72" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-20" />
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    </div>
  );
}
