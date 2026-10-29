"use client";

import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { Page, PageBody, PageToolbar } from "@repo/ui/page";
import { Skeleton } from "@repo/ui/skeleton";
import { SplitList, SplitView } from "@repo/ui/split-view";
import { Textarea } from "@repo/ui/textarea";
import {
  type FilterOption,
  FilterTabs,
  SearchField,
  ToolbarSpacer,
} from "@repo/ui/toolbar";
import {
  FolderPlus,
  List as ListIcon,
  Loader2,
  Network,
  RefreshCcw,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useEntityGraphData } from "@/components/graph/entity-graph";
import { DashboardPageHeader } from "@/components/navigation/dashboard-page-header";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type {
  IPerson,
  IPersonEdge,
  IPersonGraph,
  IPersonGroup,
} from "@/lib/data-types";
import { buildDescendantIdMap, buildPathLabelMap } from "@/lib/note-group-tree";
import { cn } from "@/lib/utils";
import { PersonDetail } from "./_components/person-detail";
import { getPersonGroupIds, PersonGraph } from "./_components/person-graph";
import { PersonGroupDetail } from "./_components/person-group-detail";
import { PersonList } from "./_components/person-list";

type View = "graph" | "list";
type Selection =
  | { kind: "person"; id: string }
  | { kind: "group"; id: string }
  | null;

const ALL = "all";

function matchesQuery(person: IPerson, query: string, groupLabels: string[]) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    person.name,
    person.placeMet,
    person.notes,
    person.email,
    person.phone,
    ...groupLabels,
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(normalized));
}

export default function PeoplePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { settings, loading: loadingSettings } = useUserSettings();
  const api = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi();
  }, [settings, loadingSettings]);

  const [view, setView] = useState<View>("list");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [people, setPeople] = useState<IPerson[]>([]);
  const [groups, setGroups] = useState<IPersonGroup[]>([]);
  const [edges, setEdges] = useState<IPersonEdge[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>(ALL);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groupPending, setGroupPending] = useState(false);

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

  const personParam = searchParams.get("person");
  useEffect(() => {
    if (personParam && people.some((person) => person._id === personParam)) {
      setSelection({ kind: "person", id: personParam });
      setView("list");
    }
  }, [people, personParam]);

  const pathLabelById = useMemo(() => buildPathLabelMap(groups), [groups]);
  const descendantIdsByGroup = useMemo(
    () => buildDescendantIdMap(groups),
    [groups],
  );
  const groupScope = useMemo(() => {
    if (groupFilter === ALL) return null;
    return descendantIdsByGroup.get(groupFilter) ?? new Set([groupFilter]);
  }, [descendantIdsByGroup, groupFilter]);

  const searchedPeople = useMemo(
    () =>
      people.filter((person) => {
        const labels = person.groupIds
          .map((groupId) => pathLabelById.get(groupId))
          .filter((label): label is string => Boolean(label));
        return matchesQuery(person, query, labels);
      }),
    [pathLabelById, people, query],
  );

  const visiblePeople = useMemo(
    () =>
      searchedPeople
        .filter(
          (person) =>
            !groupScope ||
            person.groupIds.some((groupId) => groupScope.has(groupId)),
        )
        .sort((left, right) => left.name.localeCompare(right.name)),
    [groupScope, searchedPeople],
  );

  const rootGroups = useMemo(
    () =>
      groups
        .filter(
          (group) =>
            !group.parentId ||
            !groups.some((candidate) => candidate._id === group.parentId),
        )
        .sort((left, right) => left.name.localeCompare(right.name)),
    [groups],
  );

  const filterOptions = useMemo<FilterOption<string>[]>(() => {
    const countIn = (groupId: string) => {
      const scope = descendantIdsByGroup.get(groupId) ?? new Set([groupId]);
      return searchedPeople.filter((person) =>
        person.groupIds.some((id) => scope.has(id)),
      ).length;
    };
    return [
      { value: ALL, label: "All", count: searchedPeople.length },
      ...rootGroups.map((group) => ({
        value: group._id,
        label: group.name,
        count: countIn(group._id),
      })),
    ];
  }, [descendantIdsByGroup, rootGroups, searchedPeople]);

  useEffect(() => {
    if (groupFilter !== ALL && !groups.some((g) => g._id === groupFilter)) {
      setGroupFilter(ALL);
    }
  }, [groupFilter, groups]);

  const relationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of edges) {
      counts.set(edge.from, (counts.get(edge.from) ?? 0) + 1);
      counts.set(edge.to, (counts.get(edge.to) ?? 0) + 1);
    }
    return counts;
  }, [edges]);

  const { visibleGroups: graphGroups, visibleEdges: graphEdges } =
    useEntityGraphData({
      items: visiblePeople,
      groups,
      edges,
      getItemGroupIds: getPersonGroupIds,
    });

  const selectedPerson = useMemo(
    () =>
      selection?.kind === "person"
        ? (people.find((person) => person._id === selection.id) ?? null)
        : null,
    [people, selection],
  );
  const selectedGroup = useMemo(
    () =>
      selection?.kind === "group"
        ? (groups.find((group) => group._id === selection.id) ?? null)
        : null,
    [groups, selection],
  );

  const selectPerson = (person: IPerson) => {
    setSelection({ kind: "person", id: person._id });
    setView("list");
  };
  const selectGroup = (group: IPersonGroup) => {
    setSelection({ kind: "group", id: group._id });
    setView("list");
  };
  const clearSelection = () => {
    setSelection(null);
    if (personParam) router.replace("/dashboard/people");
  };

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
    toast.success("Saved");
    // Relations are symmetric: the other ends' edges changed server-side.
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
    clearSelection();
    setPeople((current) => current.filter((person) => person._id !== id));
    setEdges((current) =>
      current.filter((edge) => edge.from !== id && edge.to !== id),
    );
    toast.success("Deleted");
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
    setGroupPending(true);
    const group = await createPersonGroup(groupName, groupDescription);
    setGroupPending(false);
    if (!group) return;
    setCreatingGroup(false);
    setGroupName("");
    setGroupDescription("");
    setSelection({ kind: "group", id: group._id });
    setView("list");
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
    setSelection(null);
    await load(true);
  };

  const detailOpen = Boolean(selectedPerson || selectedGroup);

  return (
    <Page>
      <DashboardPageHeader icon={<UsersRound />} title="People">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={view === "list" ? "Graph" : "List"}
          onClick={() => setView(view === "list" ? "graph" : "list")}
        >
          {view === "list" ? <Network /> : <ListIcon />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh"
          disabled={refreshing || loading}
          onClick={() => void load(true)}
        >
          {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCreatingGroup(true)}
        >
          <FolderPlus />
          Group
        </Button>
        <Button size="sm" onClick={() => router.push("/dashboard/people/new")}>
          <UserPlus />
          Person
        </Button>
      </DashboardPageHeader>

      <PageToolbar>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search people"
          className="w-full sm:w-64"
        />
        <FilterTabs
          value={groupFilter}
          onChange={setGroupFilter}
          options={filterOptions}
          className="min-w-0 overflow-x-auto"
        />
        <ToolbarSpacer />
        <span className="text-xs tabular-nums text-muted-foreground">
          {visiblePeople.length}/{people.length}
        </span>
      </PageToolbar>

      {loading ? (
        <PeopleLoadingSkeleton />
      ) : view === "graph" ? (
        <PageBody bleed>
          <PersonGraph
            people={visiblePeople}
            groups={graphGroups}
            edges={graphEdges}
            onSelectPerson={selectPerson}
            onSelectGroup={selectGroup}
          />
        </PageBody>
      ) : (
        <SplitView
          detailOpen={detailOpen}
          listWidth="md:w-80"
          list={
            <SplitList>
              <PersonList
                people={visiblePeople}
                groups={groups}
                relationCounts={relationCounts}
                selectedId={selectedPerson?._id ?? null}
                onSelect={selectPerson}
              />
            </SplitList>
          }
          detail={
            selectedPerson ? (
              <PersonDetail
                key={selectedPerson._id}
                person={selectedPerson}
                people={people}
                groups={groups}
                edges={edges}
                api={api}
                onCreateGroup={(name) => createPersonGroup(name)}
                onBack={clearSelection}
                onSave={(body) => savePerson(selectedPerson._id, body)}
                onDelete={() => deletePerson(selectedPerson._id)}
              />
            ) : selectedGroup ? (
              <PersonGroupDetail
                key={selectedGroup._id}
                group={selectedGroup}
                groups={groups}
                people={people}
                onBack={clearSelection}
                onUpdate={updateGroup}
                onDelete={deleteGroup}
                onSelectPerson={selectPerson}
              />
            ) : (
              <EmptyState icon={<UsersRound />} label="No person selected" />
            )
          }
        />
      )}

      <FormDialog
        open={creatingGroup}
        onOpenChange={setCreatingGroup}
        title="New group"
        submitLabel="Create"
        submitDisabled={!groupName.trim()}
        pending={groupPending}
        onSubmit={createGroup}
      >
        <FormGrid>
          <FormField
            label="Name"
            htmlFor="person-group-name"
            className="sm:col-span-2"
          >
            <Input
              id="person-group-name"
              autoFocus
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
            />
          </FormField>
          <FormField
            label="Description"
            htmlFor="person-group-description"
            className="sm:col-span-2"
          >
            <Textarea
              id="person-group-description"
              rows={6}
              value={groupDescription}
              onChange={(event) => setGroupDescription(event.target.value)}
            />
          </FormField>
        </FormGrid>
      </FormDialog>
    </Page>
  );
}

function PeopleLoadingSkeleton() {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-full flex-col gap-1 border-r p-2 md:w-80">
        {Array.from({ length: 12 }).map((_, index) => (
          <div key={index} className="flex h-11 items-center gap-3 px-2">
            <Skeleton className="size-5 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className={cn("h-3.5", index % 2 ? "w-28" : "w-36")} />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-3 w-10" />
          </div>
        ))}
      </div>
      <div className="hidden flex-1 md:block" />
    </div>
  );
}
