import { describe, expect, it } from "vitest";
import { SLA_MINUTES, nearestZone, nextPriority, safetyScore } from "@/lib/domain";
import { suggest } from "@/lib/suggest";
import { createIssueSchema, patchIssueSchema, sosSchema } from "@/lib/validation";

describe("suggest()", () => {
  it("flags life-threatening medical text as Critical", () => {
    expect(suggest("Student unconscious and bleeding near the library")).toMatchObject({ category: "Medical", priority: "Critical" });
  });
  it("classifies electrical hazards", () => {
    expect(suggest("Sparks coming from the socket in room 12")).toMatchObject({ category: "Electrical", priority: "Critical" });
    expect(suggest("The tubelight in the corridor is not working")).toMatchObject({ category: "Electrical", priority: "Medium" });
  });
  it("treats lost property as Low priority", () => {
    expect(suggest("I lost my wallet near the canteen")).toMatchObject({ category: "Lost & Found", priority: "Low" });
  });
  it("falls back to Other/Low when nothing matches", () => {
    expect(suggest("hello there")).toMatchObject({ category: "Other", priority: "Low" });
  });
  it("matches whole words only", () => {
    expect(suggest("fireplace decoration").category).not.toBe("Security");
  });
});

describe("domain helpers", () => {
  it("nextPriority climbs one level and caps at Critical", () => {
    expect(nextPriority("Low")).toBe("Medium");
    expect(nextPriority("High")).toBe("Critical");
    expect(nextPriority("Critical")).toBe("Critical");
  });
  it("gives higher priorities shorter response windows", () => {
    expect(SLA_MINUTES.Critical).toBeLessThan(SLA_MINUTES.High);
    expect(SLA_MINUTES.High).toBeLessThan(SLA_MINUTES.Medium);
    expect(SLA_MINUTES.Medium).toBeLessThan(SLA_MINUTES.Low);
  });
  it("finds the nearest campus zone", () => {
    expect(nearestZone(50, 25).name).toBe("Library");
    expect(nearestZone(19, 13).name).toBe("Hostel A");
  });
  it("safetyScore drops with open critical issues and never goes below 0", () => {
    expect(safetyScore([])).toBe(100);
    expect(safetyScore([{ priority: "Critical" }])).toBeLessThan(safetyScore([{ priority: "Low" }]));
    expect(safetyScore(Array.from({ length: 50 }, () => ({ priority: "Critical" as const })))).toBe(0);
  });
});

describe("validation schemas", () => {
  const valid = { category: "Medical", priority: "High", description: "Student fell down the stairs", location: "Library" };
  it("accepts a valid report and trims text", () => {
    const r = createIssueSchema.parse({ ...valid, description: "  Student fell down the stairs  " });
    expect(r.description).toBe("Student fell down the stairs");
  });
  it("rejects unknown categories, short descriptions and out-of-range coordinates", () => {
    expect(createIssueSchema.safeParse({ ...valid, category: "Nope" }).success).toBe(false);
    expect(createIssueSchema.safeParse({ ...valid, description: "hi" }).success).toBe(false);
    expect(createIssueSchema.safeParse({ ...valid, x: 500 }).success).toBe(false);
  });
  it("SOS needs no fields at all", () => {
    expect(sosSchema.safeParse({}).success).toBe(true);
  });
  it("patch rejects invalid status values", () => {
    expect(patchIssueSchema.safeParse({ status: "Done" }).success).toBe(false);
    expect(patchIssueSchema.safeParse({ status: "Resolved", assignee: null }).success).toBe(true);
  });
});
