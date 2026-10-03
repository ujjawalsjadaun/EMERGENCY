import { z } from "zod";
import { CATEGORIES, DEPARTMENTS, PRIORITIES, STATUSES } from "./domain";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

const coords = {
  x: z.number().min(0).max(100).optional(),
  y: z.number().min(0).max(70).optional(),
};

export const createIssueSchema = z.object({
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  description: z.string().trim().min(5, "Please describe the problem (at least 5 characters)").max(2000),
  location: z.string().trim().min(1, "Location is required").max(200),
  reporter: optionalText(80),
  contact: optionalText(80),
  image: z.string().max(9_000_000).optional(),
  ...coords,
});

export const sosSchema = z.object({
  location: optionalText(200),
  reporter: optionalText(80),
  contact: optionalText(80),
  ...coords,
});

export const patchIssueSchema = z.object({
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  department: z.enum(DEPARTMENTS).optional(),
  assignee: z.string().trim().max(80).nullable().optional(),
  note: z.string().trim().max(300).optional(),
});

export const messageSchema = z.object({ text: z.string().trim().min(1, "Message is empty").max(500) });
export const voteSchema = z.object({ client: z.string().min(8).max(64) });
export const loginSchema = z.object({ password: z.string().min(1).max(200) });
export const suggestSchema = z.object({ description: z.string().max(2000) });

export type CreateIssueInput = z.infer<typeof createIssueSchema>;
export type SosInput = z.infer<typeof sosSchema>;
export type PatchIssueInput = z.infer<typeof patchIssueSchema>;
