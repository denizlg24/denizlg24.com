import { describe, expect, it } from "bun:test";

import {
  BINDING_NAMESPACE_RESOURCE_KIND,
  bindingReferenceResourceKind,
  DEPLOY_BINDING_NAMESPACE_NAMES,
  DEPLOY_BINDING_REFERENCES,
} from "./deploy-env";
import { RESOURCE_KINDS } from "./resources";

/**
 * A project's storage tab attributes each env var to the resource it resolves
 * through. Get this mapping wrong and the tab claims a postgres connection
 * injects the meilisearch key — which reads as a real fact, not as a bug.
 */
describe("bindingReferenceResourceKind", () => {
  it("maps every resource kind to exactly one namespace", () => {
    const mapped = Object.values(BINDING_NAMESPACE_RESOURCE_KIND);
    expect(new Set(mapped).size).toBe(mapped.length);
    expect(new Set(mapped)).toEqual(new Set(RESOURCE_KINDS));
  });

  it("resolves a reference to the kind that provisions it", () => {
    expect(bindingReferenceResourceKind("database.postgres.url")).toBe(
      "postgres",
    );
    expect(bindingReferenceResourceKind("search.meilisearch.key")).toBe(
      "meilisearch",
    );
    expect(bindingReferenceResourceKind("s3.bucket")).toBe("s3");
  });

  /**
   * `deployment` and `project` are facts about the build, always injected. A
   * connection must never be credited with them.
   */
  it("credits no resource for the always-injected namespaces", () => {
    expect(bindingReferenceResourceKind("deployment.hostname")).toBeNull();
    expect(bindingReferenceResourceKind("project.slug")).toBeNull();
  });

  it("refuses anything outside the closed vocabulary", () => {
    expect(bindingReferenceResourceKind("database.postgres.urL")).toBeNull();
    expect(bindingReferenceResourceKind("database.mysql.url")).toBeNull();
    expect(bindingReferenceResourceKind("")).toBeNull();
  });

  it("classifies every reference in the vocabulary without throwing", () => {
    for (const reference of DEPLOY_BINDING_REFERENCES) {
      const kind = bindingReferenceResourceKind(reference);
      expect(kind === null || RESOURCE_KINDS.includes(kind)).toBe(true);
    }
  });

  /**
   * A namespace added without a mapping silently attributes nothing, so the new
   * store would never appear on any project's storage tab. Fail loudly here
   * instead — the only namespaces allowed to be absent are the two that are
   * always injected.
   */
  it("leaves only the always-injected namespaces unmapped", () => {
    const unmapped = DEPLOY_BINDING_NAMESPACE_NAMES.filter(
      (namespace) => BINDING_NAMESPACE_RESOURCE_KIND[namespace] === undefined,
    );
    expect(unmapped.sort()).toEqual(["deployment", "project"]);
  });
});
