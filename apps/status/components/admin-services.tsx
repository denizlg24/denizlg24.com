import { Input } from "@repo/ui/input";
import { NativeSelect } from "@repo/ui/native-select";
import { Textarea } from "@repo/ui/textarea";
import { ChevronDown, ChevronUp, Eye, EyeOff } from "lucide-react";
import { Dot } from "@/components/health";
import type { StatusConfig } from "@/lib/config";
import { freshStatus } from "@/lib/health";
import type { Service } from "@/lib/model";
import {
  ActionButton,
  AdminForm,
  OptimisticServiceOrder,
} from "./admin-feedback";
import { Disclosure, Field, Fields } from "./admin-forms";
import { SectionHeading } from "./shell";

/**
 * Every tile the collector knows about, shown or not. Visibility is the whole
 * point of the view: a hidden service still collects, it just does not appear on
 * the public page, so turning one off is not the same as deleting its history.
 */
export function ServicesAdmin({
  services,
  config,
  groups,
}: {
  services: Service[];
  config: StatusConfig;
  groups: string[];
}) {
  const now = Date.now();
  const byGroup = groups
    .map((group) => ({
      group,
      items: services.filter(
        (service) =>
          (config.services[service.id]?.group || service.group) === group,
      ),
    }))
    .filter((entry) => entry.items.length);
  const ungrouped = services.filter(
    (service) =>
      !groups.includes(config.services[service.id]?.group || service.group),
  );
  return (
    <section>
      <p className="mb-6 text-sm text-muted-foreground">
        {
          services.filter((s) => config.services[s.id]?.visible !== false)
            .length
        }{" "}
        of {services.length} shown
      </p>
      {[
        ...byGroup,
        ...(ungrouped.length ? [{ group: "Ungrouped", items: ungrouped }] : []),
      ].map(({ group, items }) => (
        <section className="mb-8" key={group}>
          <SectionHeading title={group} />
          <OptimisticServiceOrder
            entries={items.map((service, index) => {
              const override = config.services[service.id] ?? {};
              const visible = override.visible !== false;
              const status = freshStatus(
                service.status,
                service.checkedAt,
                now,
              );
              return {
                id: service.id,
                content: (
                  <Disclosure
                    id={service.id}
                    key={service.id}
                    summary={
                      <>
                        <Dot status={status} />
                        <span className="truncate font-medium">
                          {service.name}
                        </span>
                        {!visible ? (
                          <EyeOff
                            aria-label="Hidden"
                            className="size-3.5 shrink-0 text-muted-foreground"
                          />
                        ) : null}
                        <code className="truncate font-mono text-xs text-muted-foreground">
                          {service.id}
                        </code>
                      </>
                    }
                    note={
                      <span className="flex items-center gap-1">
                        {[
                          ["up", ChevronUp, index === 0],
                          ["down", ChevronDown, index === items.length - 1],
                        ].map(([direction, Icon, disabled]) => {
                          const Glyph = Icon as typeof ChevronUp;
                          return (
                            <AdminForm
                              compact
                              key={String(direction)}
                              targetId={service.id}
                            >
                              <Fields
                                operation="config-service-move"
                                id={service.id}
                              />
                              <input
                                type="hidden"
                                name="direction"
                                value={String(direction)}
                              />
                              <ActionButton
                                type="submit"
                                size="icon-xs"
                                variant="ghost"
                                disabled={Boolean(disabled)}
                                aria-label={`Move ${service.name} ${direction}`}
                              >
                                <Glyph aria-hidden />
                              </ActionButton>
                            </AdminForm>
                          );
                        })}
                      </span>
                    }
                  >
                    <AdminForm
                      className="max-w-xl space-y-4"
                      targetId={service.id}
                    >
                      <Fields operation="config-service" id={service.id} />
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Shown on the public page">
                          <NativeSelect
                            name="visible"
                            defaultValue={String(visible)}
                            className="w-full"
                          >
                            <option value="true">Shown</option>
                            <option value="false">Hidden</option>
                          </NativeSelect>
                        </Field>
                        <Field label="Group">
                          <NativeSelect
                            name="group"
                            defaultValue={override.group ?? service.group}
                            className="w-full"
                          >
                            {Array.from(
                              new Set([...groups, service.group]),
                            ).map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </NativeSelect>
                        </Field>
                      </div>
                      <Field
                        label="Display name"
                        hint={`Collector default: ${service.name}`}
                      >
                        <Input
                          name="name"
                          defaultValue={override.name ?? ""}
                          maxLength={80}
                          placeholder={service.name}
                        />
                      </Field>
                      <Field label="Description">
                        <Textarea
                          name="description"
                          defaultValue={override.description ?? ""}
                          rows={2}
                          maxLength={400}
                          placeholder={service.description}
                        />
                      </Field>
                      <ActionButton type="submit" size="sm">
                        <Eye aria-hidden />
                        Save
                      </ActionButton>
                    </AdminForm>
                  </Disclosure>
                ),
              };
            })}
          />
        </section>
      ))}
    </section>
  );
}
