"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@repo/ui/alert-dialog";
import { Button } from "@repo/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@repo/ui/command";
import { Input } from "@repo/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import {
  ArrowLeft,
  AtSign,
  Calendar as CalendarIcon,
  Check,
  FolderTree,
  Globe,
  Home,
  ImagePlus,
  Link as LinkIcon,
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
  const preset = socialPresetFor(platform);
  return preset?.icon ?? Globe;
}

function socialUrl(social: IPersonSocial) {
  if (social.url) return social.url;
  const preset = socialPresetFor(social.platform);
  if (preset?.buildUrl) return preset.buildUrl(social.handle);
  return undefined;
}

interface Props {
  person: IPerson;
  people: IPerson[];
  groups: IPersonGroup[];
  edges: IPersonEdge[];
  api: denizApi | null;
  mode?: "edit" | "draft";
  saving?: boolean;
  onBack: () => void;
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
    month: "2-digit",
    day: "2-digit",
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
    if (
      relations.some(
        (relation) =>
          !relationMap.has(relation.personId) ||
          relationMap.get(relation.personId) !== (relation.reason ?? ""),
      )
    )
      return true;
    return false;
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
      toast.error("Use birthday format MM-DD or YYYY-MM-DD");
      return;
    }
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
      relations: relations.map((relation) => ({
        ...relation,
        reason: relation.reason?.trim() || undefined,
      })),
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center justify-between border-b px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={onBack} title="Back">
            <ArrowLeft className="size-4" />
          </Button>
          {photos[0] ? (
            <Image
              src={photos[0]}
              alt=""
              width={16}
              height={16}
              className="size-4 rounded-full object-cover"
              unoptimized
            />
          ) : (
            <UserRound className="size-4" />
          )}
          <span className="truncate text-xs text-muted-foreground">
            {isDraft ? "Write notes and create a person" : "Person note"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {onDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-destructive hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this person?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Relations and generated birthday events will be removed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => void onDelete()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full px-6 py-6">
          <div className="flex items-start gap-5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="group relative size-24 shrink-0 overflow-hidden rounded-full border bg-muted"
              title={
                photos[0] ? "Change profile picture" : "Add profile picture"
              }
            >
              {photos[0] ? (
                <>
                  <Image
                    src={photos[0]}
                    alt=""
                    fill
                    className="object-cover"
                    unoptimized
                  />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/35 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                    Change
                  </span>
                </>
              ) : (
                <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <ImagePlus className="size-6" />
                </span>
              )}
            </button>
            <div className="min-w-0 flex-1">
              <Input
                autoFocus={isDraft}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="h-auto! border-none bg-transparent px-0 py-1 text-2xl font-semibold shadow-none focus-visible:ring-0"
                placeholder="Untitled person"
              />
              <ContactIconBar
                email={email}
                phone={phone}
                website={website}
                socials={socials}
              />
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-6">
            <PropertySection label="Identity">
              <PropertyRow
                icon={<UserRound className="size-3" />}
                label="photo"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {uploading ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : photos[0] ? (
                      <Image
                        src={photos[0]}
                        alt=""
                        width={16}
                        height={16}
                        className="size-4 rounded-full object-cover"
                        unoptimized
                      />
                    ) : (
                      <ImagePlus className="size-3" />
                    )}
                    {photos[0]
                      ? "Change profile picture"
                      : "Add profile picture"}
                  </button>
                  {photos[0] && (
                    <button
                      type="button"
                      onClick={() => setPhotos((current) => current.slice(1))}
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Remove profile picture"
                    >
                      <X className="size-3" />
                    </button>
                  )}
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
                </div>
              </PropertyRow>

              <PropertyRow
                icon={<CalendarIcon className="size-3" />}
                label="birthday"
              >
                <BirthdayProperty
                  value={birthdayText}
                  onChange={setBirthdayText}
                />
              </PropertyRow>

              <PropertyRow
                icon={<MapPin className="size-3" />}
                label="place_met"
              >
                <PlaceAutocomplete
                  value={placeMet}
                  suggestions={placeSuggestions}
                  onChange={setPlaceMet}
                />
              </PropertyRow>
            </PropertySection>

            <PropertySection label="Contact">
              <PropertyRow icon={<Mail className="size-3" />} label="email">
                <TextProperty
                  value={email}
                  onChange={setEmail}
                  placeholder="name@example.com"
                  type="email"
                />
              </PropertyRow>

              <PropertyRow icon={<Phone className="size-3" />} label="phone">
                <TextProperty
                  value={phone}
                  onChange={setPhone}
                  placeholder="+351 ..."
                  type="tel"
                />
              </PropertyRow>

              <PropertyRow icon={<Globe className="size-3" />} label="website">
                <TextProperty
                  value={website}
                  onChange={setWebsite}
                  placeholder="https://..."
                  type="url"
                />
              </PropertyRow>

              <PropertyRow icon={<Home className="size-3" />} label="address">
                <TextProperty
                  value={address}
                  onChange={setAddress}
                  placeholder="City, country"
                />
              </PropertyRow>

              <PropertyRow icon={<AtSign className="size-3" />} label="socials">
                <SocialsProperty value={socials} onChange={setSocials} />
              </PropertyRow>
            </PropertySection>

            <PropertySection label="Connections">
              <PropertyRow
                icon={<FolderTree className="size-3" />}
                label="groups"
              >
                <GroupTreeCombobox
                  groups={groups}
                  value={groupIds}
                  onChange={setGroupIds}
                  onCreateGroup={onCreateGroup}
                  placeholder="Add group…"
                  searchPlaceholder="Search group hierarchy…"
                />
              </PropertyRow>

              <PropertyRow
                icon={<LinkIcon className="size-3" />}
                label="relations"
              >
                <div className="flex flex-wrap items-center gap-1">
                  {relations.length === 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      None
                    </span>
                  )}
                  {relations.map((relation) => (
                    <span
                      key={relation.personId}
                      className="group inline-flex items-center gap-1 rounded-md border bg-muted/20 px-1.5 py-0.5 text-[10px]"
                    >
                      <span className="font-medium">
                        {peopleById.get(relation.personId)?.name ?? "Unknown"}
                      </span>
                      <Input
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
                        placeholder="note"
                        className="h-4 w-24 border-none bg-transparent px-1 text-[10px] text-muted-foreground shadow-none focus-visible:ring-0"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setRelations((current) =>
                            current.filter(
                              (item) => item.personId !== relation.personId,
                            ),
                          )
                        }
                        className="text-muted-foreground opacity-60 hover:opacity-100"
                        aria-label="Remove relation"
                      >
                        <X className="size-2.5" />
                      </button>
                    </span>
                  ))}
                  <RelationPicker
                    people={relationOptions}
                    onSelect={(personId) =>
                      setRelations((current) => [
                        ...current,
                        { personId, reason: undefined },
                      ])
                    }
                  />
                </div>
              </PropertyRow>
            </PropertySection>

            {!isDraft && (
              <PropertySection label="Meta">
                <PropertyRow
                  icon={<CalendarIcon className="size-3" />}
                  label="created_on"
                >
                  <span className="text-muted-foreground">
                    {formatDate(person.createdAt)}
                  </span>
                </PropertyRow>
              </PropertySection>
            )}
          </div>

          <div className="mt-8 flex min-h-[60vh] flex-col">
            <NoteEditor
              note={editorNote}
              API={null}
              onContentChange={setNotes}
              onSaveContent={save}
              saveLabel={isDraft ? "Create person" : "Save"}
              saveDisabled={saving || name.trim().length === 0 || !isDirty}
              disableAiEnhance
              startInEditMode={isDraft}
              autoFocusEditor={isDraft}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function PropertyRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-center gap-3 px-2 py-1.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="font-mono text-[11px]">{label}</span>
      </div>
      <div className="min-w-0 text-xs">{children}</div>
    </div>
  );
}

function PropertySection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </h3>
      <div className="divide-y border-y text-xs">{children}</div>
    </section>
  );
}

function TextProperty({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  type?: "text" | "email" | "tel" | "url";
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-5 w-full border-none bg-transparent px-1 text-xs outline-none placeholder:text-muted-foreground/60"
    />
  );
}

function ContactIconBar({
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
      href: `mailto:${email}`,
      title: email,
    });
  if (phone.trim())
    items.push({
      key: "phone",
      icon: Phone,
      href: `tel:${phone}`,
      title: phone,
    });
  if (website.trim())
    items.push({
      key: "website",
      icon: Globe,
      href: website.startsWith("http") ? website : `https://${website}`,
      title: website,
    });
  for (const social of socials) {
    if (!social.handle.trim()) continue;
    items.push({
      key: `social:${social.platform}:${social.handle}`,
      icon: socialIcon(social.platform),
      href: socialUrl(social),
      title: `${social.platform}: ${social.handle}`,
    });
  }

  if (items.length === 0) {
    return (
      <p className="mt-1.5 text-xs text-muted-foreground">
        Add contact details below.
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {items.map((item) => {
        const Icon = item.icon;
        const content = (
          // biome-ignore lint/correctness/useJsxKeyInIterable: rendered inside the keyed <a>/<span> below
          <span
            className="inline-flex size-7 items-center justify-center rounded-full border text-muted-foreground hover:border-foreground hover:text-foreground"
            title={item.title}
          >
            <Icon className="size-3.5" />
          </span>
        );
        return item.href ? (
          <a
            key={item.key}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {content}
          </a>
        ) : (
          <span key={item.key}>{content}</span>
        );
      })}
    </div>
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

  const addSocial = (platform: string) => {
    if (!platform.trim()) return;
    onChange([
      ...value,
      { platform: platform.trim().toLowerCase(), handle: "" },
    ]);
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

  const removeSocial = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((social, index) => {
        const Icon = socialIcon(social.platform);
        return (
          <span
            key={`${social.platform}-${index}`}
            className="group inline-flex items-center gap-1 rounded-md border bg-muted/20 px-1.5 py-0.5 text-[10px]"
          >
            <Icon className="size-3 text-muted-foreground" />
            <Input
              value={social.handle}
              onChange={(event) =>
                updateSocial(index, { handle: event.target.value })
              }
              placeholder={
                socialPresetFor(social.platform)?.label ?? social.platform
              }
              className="h-4 w-28 border-none bg-transparent px-1 text-[10px] shadow-none focus-visible:ring-0"
            />
            <button
              type="button"
              onClick={() => removeSocial(index)}
              className="text-muted-foreground opacity-60 hover:opacity-100"
              aria-label="Remove social"
            >
              <X className="size-2.5" />
            </button>
          </span>
        );
      })}

      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-dashed px-1.5 text-[10px] text-muted-foreground hover:border-solid hover:text-foreground"
          >
            <Plus className="size-2.5" />
            add
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-1" align="start" sideOffset={6}>
          <div className="flex flex-col">
            {SOCIAL_PRESETS.map((preset) => {
              const Icon = preset.icon;
              return (
                <button
                  key={preset.platform}
                  type="button"
                  onClick={() => addSocial(preset.platform)}
                  className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                >
                  <Icon className="size-3.5 text-muted-foreground" />
                  {preset.label}
                </button>
              );
            })}
            <div className="mt-1 flex items-center gap-1 border-t pt-1">
              <Input
                value={customPlatform}
                onChange={(event) => setCustomPlatform(event.target.value)}
                placeholder="custom"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && customPlatform.trim()) {
                    event.preventDefault();
                    addSocial(customPlatform);
                  }
                }}
                className="h-7 text-xs"
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 px-2"
                onClick={() => addSocial(customPlatform)}
                disabled={!customPlatform.trim()}
              >
                <Plus className="size-3" />
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function BirthdayProperty({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <Input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="MM-DD or YYYY-MM-DD"
      className="h-6 max-w-48 border-none bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
    />
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
      <div className="inline-flex w-fit min-w-0 max-w-[min(100%,24rem)] items-center gap-1 overflow-hidden align-middle">
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-dashed px-1.5 text-[10px] text-muted-foreground hover:border-solid hover:text-foreground"
          >
            <Plus className="size-2.5" />
            {value.trim() || "Add place…"}
          </button>
        </PopoverTrigger>
        {value.trim() && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              setQuery("");
            }}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Clear place"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput
            value={query}
            onValueChange={(next) => {
              setQuery(next);
            }}
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
                  className="w-full px-2 py-1.5 text-left text-xs hover:bg-muted"
                >
                  Use &ldquo;{query.trim()}&rdquo;
                </button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  No places yet
                </span>
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
                      className={`mr-1 size-3 ${
                        place.toLowerCase() === value.trim().toLowerCase()
                          ? "opacity-100"
                          : "opacity-0"
                      }`}
                    />
                    {place}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {canCreate && options.length > 0 && (
              <CommandGroup heading="Use">
                <CommandItem
                  value={`__use_${query}`}
                  onSelect={() => commit(query)}
                  className="text-xs"
                >
                  <Plus className="mr-1 size-3" />
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
        <button
          type="button"
          className="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-dashed px-1.5 text-[10px] text-muted-foreground hover:border-solid hover:text-foreground"
        >
          <Plus className="size-2.5" />
          related person
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(22rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
        align="start"
        sideOffset={6}
      >
        <Command>
          <CommandInput placeholder="Find person…" />
          <CommandList>
            <CommandEmpty>
              <span className="text-xs text-muted-foreground">
                No people found
              </span>
            </CommandEmpty>
            <CommandGroup heading="People">
              {people.map((person) => (
                <CommandItem
                  key={person._id}
                  value={person.name}
                  onSelect={() => {
                    onSelect(person._id);
                    setOpen(false);
                  }}
                  className="text-xs"
                >
                  {person.photos[0] ? (
                    <Image
                      src={person.photos[0]}
                      alt=""
                      width={14}
                      height={14}
                      className="mr-1 size-3.5 rounded-full object-cover"
                      unoptimized
                    />
                  ) : (
                    <UserRound className="mr-1 size-3.5" />
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
