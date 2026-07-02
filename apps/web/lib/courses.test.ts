import { describe, expect, mock, test } from "bun:test";
import type { ICourseAssignment } from "@repo/schemas";

mock.module("@/lib/mongodb", () => ({ connectDB: mock(async () => {}) }));

const { computeGradeProjection, requiredAverageForTarget } = await import(
  "@/lib/courses"
);

let counter = 0;
function makeAssignment(
  overrides: Partial<ICourseAssignment> = {},
): ICourseAssignment {
  counter += 1;
  return {
    _id: `assignment-${counter}`,
    courseId: "course-1",
    title: `Assignment ${counter}`,
    type: "assignment",
    status: "graded",
    links: [],
    files: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeGradeProjection", () => {
  test("returns nulls when nothing is graded", () => {
    const projection = computeGradeProjection([
      makeAssignment({ status: "planned" }),
    ]);
    expect(projection).toEqual({
      currentAverage: null,
      gradedWeight: null,
      remainingWeight: null,
      bestCase: null,
      worstCase: null,
    });
  });

  test("computes average but no projection without weights", () => {
    const projection = computeGradeProjection([
      makeAssignment({ grade: { score: 16, maxScore: 20 } }),
      makeAssignment({ grade: { score: 60, maxScore: 100 } }),
    ]);
    expect(projection.currentAverage).toBeCloseTo(70);
    expect(projection.gradedWeight).toBeNull();
    expect(projection.bestCase).toBeNull();
    expect(projection.worstCase).toBeNull();
  });

  test("computes weighted projection", () => {
    const projection = computeGradeProjection([
      makeAssignment({ grade: { score: 80, maxScore: 100, weight: 30 } }),
      makeAssignment({ grade: { score: 60, maxScore: 100, weight: 20 } }),
      makeAssignment({ status: "planned" }),
    ]);
    expect(projection.currentAverage).toBeCloseTo(72);
    expect(projection.gradedWeight).toBe(50);
    expect(projection.remainingWeight).toBe(50);
    expect(projection.worstCase).toBeCloseTo(36);
    expect(projection.bestCase).toBeCloseTo(86);
  });

  test("ignores archived assignments", () => {
    const projection = computeGradeProjection([
      makeAssignment({ grade: { score: 80, maxScore: 100, weight: 30 } }),
      makeAssignment({
        status: "archived",
        grade: { score: 0, maxScore: 100, weight: 70 },
      }),
    ]);
    expect(projection.gradedWeight).toBe(30);
    expect(projection.worstCase).toBeCloseTo(24);
    expect(projection.bestCase).toBeCloseTo(94);
  });

  test("clamps malformed weights that sum past 100", () => {
    const projection = computeGradeProjection([
      makeAssignment({ grade: { score: 100, maxScore: 100, weight: 80 } }),
      makeAssignment({ grade: { score: 100, maxScore: 100, weight: 80 } }),
    ]);
    expect(projection.gradedWeight).toBe(100);
    expect(projection.remainingWeight).toBe(0);
    expect(projection.worstCase).toBeCloseTo(100);
    expect(projection.bestCase).toBeCloseTo(100);
  });
});

describe("requiredAverageForTarget", () => {
  const projection = computeGradeProjection([
    makeAssignment({ grade: { score: 80, maxScore: 100, weight: 30 } }),
    makeAssignment({ grade: { score: 60, maxScore: 100, weight: 20 } }),
  ]);

  test("computes the average needed on remaining weight", () => {
    expect(requiredAverageForTarget(projection, 70)).toBeCloseTo(68);
  });

  test("goes past 100 when the target is out of reach", () => {
    const required = requiredAverageForTarget(projection, 90);
    expect(required).not.toBeNull();
    expect(required ?? 0).toBeGreaterThan(100);
  });

  test("goes negative when the target is already secured", () => {
    const required = requiredAverageForTarget(projection, 30);
    expect(required).not.toBeNull();
    expect(required ?? 0).toBeLessThanOrEqual(0);
  });

  test("returns null without weighted grades or remaining weight", () => {
    expect(requiredAverageForTarget(computeGradeProjection([]), 70)).toBeNull();
    const settled = computeGradeProjection([
      makeAssignment({ grade: { score: 70, maxScore: 100, weight: 100 } }),
    ]);
    expect(requiredAverageForTarget(settled, 80)).toBeNull();
  });
});
