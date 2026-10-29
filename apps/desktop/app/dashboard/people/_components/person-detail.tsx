"use client";

import { Button } from "@repo/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@repo/ui/command";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import { DropdownMenuItem } from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListRow } from "@repo/ui/list";
import { PageBody, PageTitle } from "@repo/ui/page";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { Properties, Property } from "@repo/ui/properties";
import { Section } from "@repo/ui/section";
import { RowActions } from "@repo/ui/toolbar";
import {
  ArrowLeft,
  AtSign,
  Calendar as CalendarIcon,
  Check,
  Clock,
  FolderTree,
  Globe,
  Home,
  ImagePlus,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Plus,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FaGithub,
  FaInstagram,
  FaLinkedin,
  FaTwitter,
  FaYoutube,
} from "react-icons/fa6";
import { toast } from "sonner";
import { GroupTreeCombobox } from "@/app/dashboard/notes/_components/group-tree-combobox";
import { NoteEditor } from "@/app/dashboard/notes/_components/note-editor";
import type { denizApi } from "@/lib/api-wrapper";
import type {
  BirthdayParts,
  INote,
  IPerson,
  IPersonEdge,
  IPersonGroup,
  IPersonSocial,
} from "@/lib/data-types";
import { cn } from "@/lib/utils";
import { PersonAvatar } from "./person-avatar";

interface RelationDraft {
  personId: string;
  reason?: string;
}

interface SocialPreset {
  platform: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  buildUrl?: (handle: string) => string;
}

const SOCIAL_PRESETS: SocialPreset[] = [
  {
    platform: "github",
    label: "GitHub",
    icon: FaGithub,
    buildUrl: (h) => `https://github.com/${h.replace(/^@/, "")}`,
  },
  {
    platform: "linkedin",
    label: "LinkedIn",
    icon: FaLinkedin,
    buildUrl: (h) => `https://linkedin.com/in/${h.replace(/^@/, "")}`,
  },
  {
    platform: "twitter",
    label: "X / Twitter",
    icon: FaTwitter,
    buildUrl: (h) => `https://x.com/${h.replace(/^@/, "")}`,
  },
  {
    platform: "instagram",
    label: "Instagram",
    icon: FaInstagram,
    buildUrl: (h) => `https://instagram.com/${h.replace(/^@/, "")}`,
  },
  {
    platform: "youtube",
    label: "YouTube",
    icon: FaYoutube,
    buildUrl: (h) =>
      h.startsWith("@")
        ? `https://youtube.com/${h}`
        : `https://youtube.com/@${h}`,
  },
  {
    platform: "mastodon",
    label: "Mastodon",
    icon: AtSign,
  },
];

function socialPresetFor(platform: string): SocialPreset | undefined {
  return SOCIAL_PRESETS.find(
    (preset) => preset.platform === platform.toLowerCase(),
  );
}

function socialIcon(platform: string) {
  return socialPresetFor(platform)?.icon ?? Globe;
}

function socialUrl(social: IPersonSocial) {
  if (social.url) return social.url;
  return socialPresetFor(social.platform)?.buildUrl?.(social.handle);
}

interface Props {
  person: IPerson;
  people: IPerson[];
  groups: IPersonGroup[];
  edges: IPersonEdge[];
  api: denizApi | null;
  mode?: "edit" | "draft";
  saving?: boolean;
  /** Shown below `md`, where the document replaces the list. */
  onBack?: () => void;
  onCreateGroup?: (name: string) => Promise<IPersonGroup | null>;
  onSave: (
    body: Record<string, unknown>,
  ) => Promise<IPerson | null | undefined>;
  onDelete?: () => Promise<void>;
}

function relationsFor(personId: string, edges: IPersonEdge[]) {
  return edges
    .filter((edge) => edge.from === personId || edge.to === personId)
    .map((edge) => ({
      personId: edge.from === personId ? edge.to : edge.from,
      reason: edge.reason,
    }));
}

function formatDate(value: string | Date | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatBirthdayText(birthday?: BirthdayParts | null) {
  if (!birthday) return "";
  const month = String(birthday.month).padStart(2, "0");
  const day = String(birthday.day).padStart(2, "0");
  return birthday.year ? `${birthday.year}-${month}-${day}` : `${month}-${day}`;
}

function parseBirthdayText(value: string): BirthdayParts | null | undefined {
  const text = value.trim();
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) {
    return normalizeBirthday({
      year: Number(isoMatch[1]),
      month: Number(isoMatch[2]),
      day: Number(isoMatch[3]),
    });
  }

  const monthDayMatch = text.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (monthDayMatch) {
    return normalizeBirthday({
      month: Number(monthDayMatch[1]),
      day: Number(monthDayMatch[2]),
      year: null,
    });
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return normalizeBirthday({
      month: parsed.getMonth() + 1,
      day: parsed.getDate(),
      year: /\d{4}/.test(text) ? parsed.getFullYear() : null,
    });
  }

  return undefined;
}

function normalizeBirthday(birthday: BirthdayParts) {
  if (
    !Number.isInteger(birthday.month) ||
    birthday.month < 1 ||
    birthday.month > 12 ||
    !Number.isInteger(birthday.day) ||
    birthday.day < 1 ||
    birthday.day > 31
  ) {
    return undefined;
  }
  return birthday;
}

const FLUSH_INPUT =
  "-mx-1.5 h-7 w-full rounded-md bg-transparent px-1.5 text-sm text-accent-strong outline-none transition-colors placeholder:text-muted-foreground/50 hover:bg-surface/70 focus:bg-surface/70";

const CHIP =
  "inline-flex h-6 max-w-full items-center gap-1.5 rounded-md bg-surface px-1.5 text-xs text-accent-strong";

export function PersonDetail({
  person,
  people,
  groups,
  edges,
  api,
  mode = "edit",
  saving = false,
  onBack,
  onCreateGroup,
  onSave,
  onDelete,
}: Props) {
  const isDraft = mode === "draft";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(person.name);
  const [birthdayText, setBirthdayText] = useState(
    formatBirthdayText(person.birthday),
  );
  const [placeMet, setPlaceMet] = useState(person.placeMet ?? "");
  const [notes, setNotes] = useState(person.notes);
  const [photos, setPhotos] = useState(person.photos);
  const [groupIds, setGroupIds] = useState(person.groupIds);
  const [relations, setRelations] = useState<RelationDraft[]>(
    relationsFor(person._id, edges),
  );
  const [email, setEmail] = useState(person.email ?? "");
  const [phone, setPhone] = useState(person.phone ?? "");
  const [website, setWebsite] = useState(person.website ?? "");
  const [address, setAddress] = useState(person.address ?? "");
  const [socials, setSocials] = useState<IPersonSocial[]>(person.socials ?? []);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setName(person.name);
    setBirthdayText(formatBirthdayText(person.birthday));
    setPlaceMet(person.placeMet ?? "");
    setNotes(person.notes);
    setPhotos(person.photos);
    setGroupIds(person.groupIds);
    setRelations(relationsFor(person._id, edges));
    setEmail(person.email ?? "");
    setPhone(person.phone ?? "");
    setWebsite(person.website ?? "");
    setAddress(person.address ?? "");
    setSocials(person.socials ?? []);
  }, [edges, person]);

  const relationOptions = useMemo(
    () =>
      people.filter(
        (candidate) =>
          candidate._id !== person._id &&
          !relations.some((relation) => relation.personId === candidate._id),
      ),
    [people, person._id, relations],
  );
  const peopleById = useMemo(
    () => new Map(people.map((candidate) => [candidate._id, candidate])),
    [people],
  );
  const placeSuggestions = useMemo(
    () =>
      [
        ...new Set(
          people
            .map((candidate) => candidate.placeMet?.trim())
            .filter((place): place is string => Boolean(place)),
        ),
      ].sort((left, right) => left.localeCompare(right)),
    [people],
  );

  const isDirty = useMemo(() => {
    if (isDraft) return true;
    if (name !== person.name) return true;
    if (birthdayText !== formatBirthdayText(person.birthday)) return true;
    if (placeMet !== (person.placeMet ?? "")) return true;
    if (notes !== person.notes) return true;
    if (email !== (person.email ?? "")) return true;
    if (phone !== (person.phone ?? "")) return true;
    if (website !== (person.website ?? "")) return true;
    if (address !== (person.address ?? "")) return true;
    if (photos.length !== person.photos.length) return true;
    if (photos.some((url, i) => url !== person.photos[i])) return true;
    if (groupIds.length !== person.groupIds.length) return true;
    if (groupIds.some((id) => !person.groupIds.includes(id))) return true;
    const originalSocials = person.socials ?? [];
    if (socials.length !== originalSocials.length) return true;
    if (
      socials.some((social, i) => {
        const original = originalSocials[i];
        return (
          !original ||
          social.platform !== original.platform ||
          social.handle !== original.handle ||
          (social.url ?? "") !== (original.url ?? "")
        );
      })
    )
      return true;
    const originalRelations = relationsFor(person._id, edges);
    if (relations.length !== originalRelations.length) return true;
    const relationMap = new Map(
      originalRelations.map((relation) => [
        relation.personId,
        relation.reason ?? "",
      ]),
    );
    return relations.some(
      (relation) =>
        !relationMap.has(relation.personId) ||
        relationMap.get(relation.personId) !== (relation.reason ?? ""),
    );
  }, [
    isDraft,
    name,
    birthdayText,
    placeMet,
    notes,
    email,
    phone,
    website,
    address,
    photos,
    groupIds,
    socials,
    relations,
    person,
    edges,
  ]);

  const editorNote = useMemo<INote>(() => {
    const now = new Date().toISOString();
    return {
      _id: person._id,
      title: name || "Untitled person",
      content: notes,
      tags: [],
      groupIds,
      status: "open",
      createdAt: person.createdAt || now,
      updatedAt: person.updatedAt || now,
    };
  }, [groupIds, name, notes, person]);

  const uploadPhoto = async (file: File) => {
    if (!api) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    const result = await api.UPLOAD<{ url: string; hash: string }>({
      endpoint: "upload",
      formData,
    });
    setUploading(false);
    if ("code" in result) {
      toast.error(result.message);
      return;
    }
    setPhotos((current) => [result.url, ...current]);
  };

  const save = async (content = notes) => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    const parsedBirthday = parseBirthdayText(birthdayText);
    if (parsedBirthday === undefined) {
      toast.error("Birthday must be MM-DD or YYYY-MM-DD");
      return;
    }
    setSubmitting(true);
    try {
      await onSave({
        name: name.trim(),
        birthday: parsedBirthday,
        placeMet: placeMet.trim() || undefined,
        notes: content,
        photos,
        groupIds,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        website: website.trim() || undefined,
        address: address.trim() || undefined,
        socials: socials
          .filter((social) => social.platform.trim() && social.handle.trim())
          .map((social) => ({
            platform: social.platform.trim().toLowerCase(),
            handle: social.handle.trim(),
            url: social.url?.trim() || undefined,
          })),
        // Relations are symmetric and replace-only: the full set is sent on
        // every save and the server rewrites both ends.
        relations: relations.map((relation) => ({
          ...relation,
          reason: relation.reason?.trim() || undefined,
        })),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const busy = saving || submitting;
  const saveDisabled = busy || name.trim().length === 0 || !isDirty;

  return (
    <PageBody width="narrow">
      <PageTitle
        icon={
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label={photos[0] ? "Change photo" : "Add photo"}
            className="group relative flex size-16 items-center justify-center overflow-hidden rounded-full bg-surface text-muted-foreground"
          >
            {photos[0] ? (
              <Image
                src={photos[0]}
                alt=""
                fill
                className="object-cover"
                unoptimized
              />
            ) : (
              <ImagePlus className="size-5" />
            )}
            {uploading ? (
              <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                <Loader2 className="size-4 animate-spin" />
              </span>
            ) : null}
          </button>
        }
        title={
          <input
            // biome-ignore lint/a11y/noAutofocus: a new person starts at the name
            autoFocus={isDraft}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Untitled"
            aria-label="Name"
            className="w-full bg-transparent outline-none placeholder:text-muted-foreground/40"
          />
        }
        actions={
          <>
            {onBack ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Back"
                className="md:hidden"
                onClick={onBack}
              >
                <ArrowLeft />
              </Button>
            ) : null}
            <Button
              size="sm"
              disabled={saveDisabled}
              onClick={() => void save()}
            >
              {busy ? <Loader2 className="animate-spin" /> : null}
              {isDraft ? "Create" : "Save"}
            </Button>
            {!isDraft && (photos[0] || onDelete) ? (
              <RowActions>
                {photos[0] ? (
                  <DropdownMenuItem
                    onSelect={() => setPhotos((current) => current.slice(1))}
                  >
                    <X />
                    Remove photo
                  </DropdownMenuItem>
                ) : null}
                {onDelete ? (
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setConfirmDelete(true)}
                  >
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                ) : null}
              </RowActions>
            ) : null}
          </>
        }
        meta={
          <ContactLinks
            email={email}
            phone={phone}
            website={website}
            socials={socials}
          />
        }
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadPhoto(file);
          event.currentTarget.value = "";
        }}
      />

      <Properties>
        <Property icon={<CalendarIcon />} label="Birthday">
          <input
            value={birthdayText}
            onChange={(event) => setBirthdayText(event.target.value)}
            placeholder="MM-DD or YYYY-MM-DD"
            className={FLUSH_INPUT}
          />
        </Property>
        <Property icon={<MapPin />} label="Place met">
          <PlaceAutocomplete
            value={placeMet}
            suggestions={placeSuggestions}
            onChange={setPlaceMet}
          />
        </Property>
        <Property icon={<Mail />} label="Email">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="—"
            className={FLUSH_INPUT}
          />
        </Property>
        <Property icon={<Phone />} label="Phone">
          <input
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="—"
            className={FLUSH_INPUT}
          />
        </Property>
        <Property icon={<Globe />} label="Website">
          <input
            type="url"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            placeholder="—"
            className={FLUSH_INPUT}
          />
        </Property>
        <Property icon={<Home />} label="Address">
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="—"
            className={FLUSH_INPUT}
          />
        </Property>
        <Property icon={<AtSign />} label="Socials">
          <SocialsProperty value={socials} onChange={setSocials} />
        </Property>
        <Property icon={<FolderTree />} label="Groups">
          <GroupTreeCombobox
            groups={groups}
            value={groupIds}
            onChange={setGroupIds}
            onCreateGroup={onCreateGroup}
            placeholder="Add group…"
            searchPlaceholder="Search groups…"
          />
        </Property>
        {!isDraft ? (
          <Property icon={<Clock />} label="Added">
            <span className="text-muted-foreground tabular-nums">
              {formatDate(person.createdAt)}
            </span>
          </Property>
        ) : null}
      </Properties>

      <Section
        title="Relations"
        count={relations.length}
        actions={
          <RelationPicker
            people={relationOptions}
            onSelect={(personId) =>
              setRelations((current) => [
                ...current,
                { personId, reason: undefined },
              ])
            }
          />
        }
      >
        {relations.length === 0 ? (
          <EmptyState compact label="No relations" />
        ) : (
          <List>
            {relations.map((relation) => {
              const related = peopleById.get(relation.personId);
              return (
                <ListRow
                  key={relation.personId}
                  leading={
                    <PersonAvatar
                      size="xs"
                      photo={related?.photos[0]}
                      name={related?.name}
                    />
                  }
                  title={related?.name ?? "Unknown"}
                  description={
                    <input
                      value={relation.reason ?? ""}
                      onChange={(event) => {
                        const reason = event.target.value;
                        setRelations((current) =>
                          current.map((item) =>
                            item.personId === relation.personId
                              ? { ...item, reason }
                              : item,
                          ),
                        );
                      }}
                      placeholder="Relation"
                      aria-label={`Relation to ${related?.name ?? "person"}`}
                      className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/50 focus:text-accent-strong"
                    />
                  }
                  trailing={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Remove relation"
                      className="text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
                      onClick={() =>
                        setRelations((current) =>
                          current.filter(
                            (item) => item.personId !== relation.personId,
                          ),
                        )
                      }
                    >
                      <X />
                    </Button>
                  }
                />
              );
            })}
          </List>
        )}
      </Section>

      <Section title="Notes">
        <div className="flex min-h-[60vh] flex-col">
          <NoteEditor
            note={editorNote}
            API={null}
            onContentChange={setNotes}
            onSaveContent={save}
            saveLabel={isDraft ? "Create" : "Save"}
            saveDisabled={saveDisabled}
            disableAiEnhance
            startInEditMode={isDraft}
          />
        </div>
      </Section>

      {onDelete ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete ${person.name || "person"}?`}
          description="Relations and birthday events go with it."
          actionLabel="Delete"
          destructive
          onConfirm={onDelete}
        />
      ) : null}
    </PageBody>
  );
}

function ContactLinks({
  email,
  phone,
  website,
  socials,
}: {
  email: string;
  phone: string;
  website: string;
  socials: IPersonSocial[];
}) {
  const items: Array<{
    key: string;
    icon: React.ComponentType<{ className?: string }>;
    href?: string;
    title: string;
  }> = [];
  if (email.trim())
    items.push({
      key: "email",
      icon: Mail,
      href: `mailto:${email.trim()}`,
      title: email,
    });
  if (phone.trim())
    items.push({
      key: "phone",
      icon: Phone,
      href: `tel:${phone.trim()}`,
      title: phone,
    });
  if (website.trim())
    items.push({
      key: "website",
      icon: Globe,
      href: website.startsWith("http") ? website : `https://${website}`,
      title: website,
    });
  socials.forEach((social, index) => {
    if (!social.handle.trim()) return;
    items.push({
      key: `social:${index}`,
      icon: socialIcon(social.platform),
      href: socialUrl(social),
      title: `${social.platform}: ${social.handle}`,
    });
  });

  if (items.length === 0) return null;

  return (
    <span className="flex flex-wrap items-center gap-0.5">
      {items.map((item) => {
        const Icon = item.icon;
        return item.href ? (
          <Button
            key={item.key}
            asChild
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
          >
            <a
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={item.title}
            >
              <Icon className="size-3.5" />
            </a>
          </Button>
        ) : (
          <span
            key={item.key}
            title={item.title}
            className="flex size-6 items-center justify-center"
          >
            <Icon className="size-3.5" />
          </span>
        );
      })}
    </span>
  );
}

function SocialsProperty({
  value,
  onChange,
}: {
  value: IPersonSocial[];
  onChange: (next: IPersonSocial[]) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customPlatform, setCustomPlatform] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const addSocial = (platform: string) => {
    if (!platform.trim()) return;
    onChange([
      ...value,
      { platform: platform.trim().toLowerCase(), handle: "" },
    ]);
    setEditingIndex(value.length);
    setPickerOpen(false);
    setCustomPlatform("");
  };

  const updateSocial = (index: number, patch: Partial<IPersonSocial>) => {
    onChange(
      value.map((social, i) =>
        i === index ? { ...social, ...patch } : social,
      ),
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-1 py-1">
      {value.map((social, index) => {
        const Icon = socialIcon(social.platform);
        const label =
          socialPresetFor(social.platform)?.label ?? social.platform;
        if (editingIndex !== index) {
          return (
            <button
              type="button"
              key={`${social.platform}-${index}`}
              onClick={() => setEditingIndex(index)}
              className={cn(CHIP, "transition-colors hover:bg-muted/60")}
            >
              <Icon className="size-3 shrink-0 text-muted-foreground" />
              <span
                className={cn(
                  "truncate",
                  !social.handle.trim() && "text-muted-foreground",
                )}
              >
                {social.handle.trim() || label}
              </span>
            </button>
          );
        }
        return (
          <span
            key={`${social.platform}-${index}`}
            className={CHIP}
            onBlur={(event) => {
              if (event.currentTarget.contains(event.relatedTarget)) return;
              setEditingIndex((current) =>
                current === index ? null : current,
              );
            }}
          >
            <Icon className="size-3 shrink-0 text-muted-foreground" />
            <input
              // biome-ignore lint/a11y/noAutofocus: the chip just switched into editing
              autoFocus
              value={social.handle}
              onChange={(event) =>
                updateSocial(index, { handle: event.target.value })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === "Escape") {
                  event.preventDefault();
                  setEditingIndex(null);
                }
              }}
              placeholder={label}
              aria-label={`${label} handle`}
              className="w-28 bg-transparent outline-none placeholder:text-muted-foreground/60"
            />
            <button
              type="button"
              // Keep the input focused so the chip's blur handler can't
              // collapse it before this click lands.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(value.filter((_, i) => i !== index));
                setEditingIndex(null);
              }}
              className="text-muted-foreground hover:text-accent-strong"
              aria-label="Remove social"
            >
              <X className="size-3" />
            </button>
          </span>
        );
      })}

      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="xs" className="text-muted-foreground">
            <Plus />
            Add
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0" align="start" sideOffset={6}>
          <Command>
            <CommandList>
              <CommandGroup>
                {SOCIAL_PRESETS.map((preset) => {
                  const Icon = preset.icon;
                  return (
                    <CommandItem
                      key={preset.platform}
                      value={preset.label}
                      onSelect={() => addSocial(preset.platform)}
                      className="text-xs"
                    >
                      <Icon className="size-3.5 text-muted-foreground" />
                      {preset.label}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
          <form
            className="flex items-center gap-1 border-t p-1"
            onSubmit={(event) => {
              event.preventDefault();
              addSocial(customPlatform);
            }}
          >
            <input
              value={customPlatform}
              onChange={(event) => setCustomPlatform(event.target.value)}
              placeholder="Other platform"
              className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground/60 focus:bg-surface/70"
            />
            <Button
              type="submit"
              size="icon-sm"
              variant="ghost"
              aria-label="Add platform"
              disabled={!customPlatform.trim()}
            >
              <Plus />
            </Button>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function PlaceAutocomplete({
  value,
  suggestions,
  onChange,
}: {
  value: string;
  suggestions: string[];
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);

  useEffect(() => setQuery(value), [value]);

  const options = suggestions.filter((place) =>
    place.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const canCreate =
    query.trim().length > 0 &&
    !suggestions.some(
      (place) => place.toLowerCase() === query.trim().toLowerCase(),
    );

  const commit = (next: string) => {
    onChange(next.trim());
    setQuery(next.trim());
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex min-w-0 items-center gap-1">
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              FLUSH_INPUT,
              "w-auto max-w-full truncate text-left",
              !value.trim() && "text-muted-foreground/50",
            )}
          >
            {value.trim() || "—"}
          </button>
        </PopoverTrigger>
        {value.trim() ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            onClick={() => {
              onChange("");
              setQuery("");
            }}
            aria-label="Clear place"
          >
            <X />
          </Button>
        ) : null}
      </div>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search places…"
            onKeyDown={(event) => {
              if (event.key === "Enter" && query.trim()) {
                event.preventDefault();
                commit(query);
              }
            }}
          />
          <CommandList>
            <CommandEmpty>
              {query.trim() ? (
                <button
                  type="button"
                  onClick={() => commit(query)}
                  className="w-full rounded-sm px-2 py-1.5 text-left text-xs hover:bg-surface"
                >
                  Use &ldquo;{query.trim()}&rdquo;
                </button>
              ) : (
                <span className="text-xs text-muted-foreground">No places</span>
              )}
            </CommandEmpty>
            {options.length > 0 && (
              <CommandGroup heading="Places">
                {options.map((place) => (
                  <CommandItem
                    key={place}
                    value={place}
                    onSelect={() => commit(place)}
                    className="text-xs"
                  >
                    <Check
                      className={cn(
                        "size-3",
                        place.toLowerCase() === value.trim().toLowerCase()
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    {place}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {canCreate && options.length > 0 && (
              <CommandGroup>
                <CommandItem
                  value={`__use_${query}`}
                  onSelect={() => commit(query)}
                  className="text-xs"
                >
                  <Plus className="size-3" />
                  Use &ldquo;{query.trim()}&rdquo;
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function RelationPicker({
  people,
  onSelect,
}: {
  people: IPerson[];
  onSelect: (personId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (people.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className="text-muted-foreground">
          <Plus />
          Add
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(22rem,calc(100vw-2rem))] overflow-hidden p-0"
        align="end"
        sideOffset={6}
      >
        <Command>
          <CommandInput placeholder="Find person…" />
          <CommandList>
            <CommandEmpty>
              <span className="text-xs text-muted-foreground">No people</span>
            </CommandEmpty>
            <CommandGroup>
              {people.map((person) => (
                <CommandItem
                  key={person._id}
                  value={`${person.name} ${person._id}`}
                  onSelect={() => {
                    onSelect(person._id);
                    setOpen(false);
                  }}
                  className="text-xs"
                >
                  {person.photos[0] ? (
                    <PersonAvatar
                      size="xs"
                      photo={person.photos[0]}
                      name={person.name}
                      className="size-4"
                    />
                  ) : (
                    <UserRound className="size-4" />
                  )}
                  {person.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
