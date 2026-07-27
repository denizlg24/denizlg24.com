import { describe, expect, it } from "bun:test";
import contractFixtures from "../../../../apps/envoy-cli/contracts/v1/fixtures.json";
import {
  envoyAddMemberInputSchema,
  envoyAuthTokenResponseSchema,
  envoyBlobAccessInputSchema,
  envoyBlobParamsSchema,
  envoyCreateProjectResponseSchema,
  envoyGithubDeviceCodeSchema,
  envoyGithubTokenInputSchema,
  envoyHeadResponseSchema,
  envoyProjectMemberResponseSchema,
  envoyProjectMembersResponseSchema,
  envoyRemoveAllMembersResponseSchema,
  envoyRemoveMemberResponseSchema,
  envoySignedUrlResponseSchema,
  envoyStatusStatsSchema,
  envoyUpdateHeadInputSchema,
} from "./index";

const PROJECT_ID = "5211d914-5dd3-49e7-b388-488c06f8120c";
const HASH = "a".repeat(64);

describe("Envoy API contracts", () => {
  it("accepts canonical project and blob identifiers", () => {
    expect(
      envoyBlobParamsSchema.parse({ projectId: PROJECT_ID, hash: HASH }),
    ).toEqual({ projectId: PROJECT_ID, hash: HASH });
    expect(
      envoyBlobParamsSchema.safeParse({
        projectId: "../outside",
        hash: HASH.toUpperCase(),
      }).success,
    ).toBe(false);
  });

  it("bounds per-file access grants", () => {
    expect(
      envoyBlobAccessInputSchema.parse({ memberIds: null }).memberIds,
    ).toBeNull();
    expect(
      envoyBlobAccessInputSchema.safeParse({
        memberIds: Array.from({ length: 501 }, () => PROJECT_ID),
      }).success,
    ).toBe(false);
  });

  it("validates optimistic head updates and device flow input", () => {
    expect(
      envoyUpdateHeadInputSchema.safeParse({
        new_head: HASH,
        expected_head: null,
      }).success,
    ).toBe(true);
    expect(
      envoyGithubTokenInputSchema.safeParse({ device_code: "" }).success,
    ).toBe(false);
  });

  it("keeps status payloads aligned with the marketing client", () => {
    expect(
      envoyStatusStatsSchema.safeParse({
        currentStatus: null,
        uptime: null,
        errorRate: null,
        avgResponseTime: null,
        totalRequests24h: 0,
        timeline: [],
        errorsByCategory: [],
        lastCheck: null,
      }).success,
    ).toBe(true);
  });

  it("validates the CLI's canonical response fixtures", () => {
    expect(
      envoyGithubDeviceCodeSchema.safeParse(contractFixtures.deviceCodeResponse)
        .success,
    ).toBe(true);
    expect(
      envoyAuthTokenResponseSchema.safeParse(contractFixtures.authTokenSuccess)
        .success,
    ).toBe(true);
    expect(
      envoyAuthTokenResponseSchema.safeParse(contractFixtures.authTokenPending)
        .success,
    ).toBe(true);
    expect(
      envoyCreateProjectResponseSchema.safeParse(
        contractFixtures.createProjectResponse,
      ).success,
    ).toBe(true);
    expect(
      envoySignedUrlResponseSchema.safeParse(
        contractFixtures.signedUploadUrlResponse,
      ).success,
    ).toBe(true);
    expect(
      envoySignedUrlResponseSchema.safeParse(
        contractFixtures.signedDownloadUrlResponse,
      ).success,
    ).toBe(true);
    expect(
      envoyHeadResponseSchema.safeParse(contractFixtures.headResponse).success,
    ).toBe(true);
    expect(
      envoyProjectMemberResponseSchema.safeParse(
        contractFixtures.addMemberResponse,
      ).success,
    ).toBe(true);
    expect(
      envoyProjectMembersResponseSchema.safeParse(
        contractFixtures.listMembersResponse,
      ).success,
    ).toBe(true);
    expect(
      envoyRemoveMemberResponseSchema.safeParse(
        contractFixtures.removeMemberResponse,
      ).success,
    ).toBe(true);
    expect(
      envoyRemoveAllMembersResponseSchema.safeParse(
        contractFixtures.removeAllMembersResponse,
      ).success,
    ).toBe(true);
  });

  it("validates the CLI's canonical request fixtures", () => {
    expect(
      envoyGithubTokenInputSchema.safeParse(contractFixtures.githubTokenRequest)
        .success,
    ).toBe(true);
    expect(
      envoyUpdateHeadInputSchema.safeParse(contractFixtures.updateHeadRequest)
        .success,
    ).toBe(true);
    expect(
      envoyBlobAccessInputSchema.safeParse(contractFixtures.blobAccessRequest)
        .success,
    ).toBe(true);
    expect(
      envoyAddMemberInputSchema.safeParse(contractFixtures.addMemberRequest)
        .success,
    ).toBe(true);
  });
});
