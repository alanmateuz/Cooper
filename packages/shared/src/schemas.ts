import { z } from "zod";
import { AGENT_KINDS, EVENT_SOURCES, TASK_LINK_KINDS, TASK_STATUSES } from "./enums.js";

export const eventSourceSchema = z.enum(EVENT_SOURCES);
export const taskStatusSchema = z.enum(TASK_STATUSES);
export const agentKindSchema = z.enum(AGENT_KINDS);
export const taskLinkKindSchema = z.enum(TASK_LINK_KINDS);

/** Motivo de recusa: obrigatório e curto. */
export const declineReasonSchema = z.string().trim().min(1).max(500);

/** Texto curto de progresso: o widget e o MCP limitam a 120 caracteres. */
export const progressTextSchema = z.string().trim().min(1).max(120);

export const createTaskInputSchema = z.object({
  workspace_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  prompt: z.string().trim().max(20000).optional().transform((v) => v || undefined),
  assignee_id: z.string().uuid().nullable().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

/** Payload de task_events. Campos livres ficam limitados para não virar depósito de conversa. */
export const taskEventPayloadSchema = z
  .object({
    text: progressTextSchema.optional(),
    files: z.array(z.string().max(300)).max(50).optional(),
    tests: z.object({ command: z.string().max(200), passed: z.boolean() }).optional(),
    branch: z.string().max(200).optional(),
    commit: z.string().regex(/^[0-9a-f]{7,40}$/).optional(),
    from_status: taskStatusSchema.optional(),
    to_status: taskStatusSchema.optional(),
    tool_name: z.string().max(100).optional(),
    assignee_id: z.string().uuid().optional(),
    reason: z.string().max(500).optional(),
    summary: z.string().max(1000).optional(),
  })
  .strict();
export type TaskEventPayload = z.infer<typeof taskEventPayloadSchema>;

export const gitSnapshotSchema = z.object({
  branch: z.string().max(200).nullable(),
  head_sha: z.string().regex(/^[0-9a-f]{40}$/).nullable(),
  ahead: z.number().int().min(0).nullable(),
  behind: z.number().int().min(0).nullable(),
  dirty_files_count: z.number().int().min(0),
  dirty_files: z.array(z.string().max(300)).max(500).nullable(),
});
export type GitSnapshotInput = z.infer<typeof gitSnapshotSchema>;
