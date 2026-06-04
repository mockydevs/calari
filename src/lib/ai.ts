import OpenAI from "openai";

const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export type AIBriefDraft = {
  goals: string;
  integrations: string[];
  contactSources: { type: "WEBSITE" | "ADS" | "MANUAL" | "OTHER"; label: string }[];
  pipelineStages: {
    order: number;
    name: string;
    description: string;
    manualActions: { description: string; owner: string }[];
  }[];
  tasks: { title: string; type: "AUTOMATION" | "FUNNEL" | "FORM" | "INTEGRATION" | "OTHER"; description: string }[];
};

const jsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    goals: { type: "string" },
    integrations: { type: "array", items: { type: "string" } },
    contactSources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ["WEBSITE", "ADS", "MANUAL", "OTHER"] },
          label: { type: "string" },
        },
        required: ["type", "label"],
      },
    },
    pipelineStages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          order: { type: "integer" },
          name: { type: "string" },
          description: { type: "string" },
          manualActions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: { description: { type: "string" }, owner: { type: "string" } },
              required: ["description", "owner"],
            },
          },
        },
        required: ["order", "name", "description", "manualActions"],
      },
    },
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          type: { type: "string", enum: ["AUTOMATION", "FUNNEL", "FORM", "INTEGRATION", "OTHER"] },
          description: { type: "string" },
        },
        required: ["title", "type", "description"],
      },
    },
  },
  required: ["goals", "integrations", "contactSources", "pipelineStages", "tasks"],
} as const;

const SYSTEM_PROMPT = `You are a senior solutions architect at an automation agency (Calari Solutions) that builds client systems in Go High Level (GHL), Zapier, and similar tools.
From the client meeting notes you are given, extract a structured build plan:
- contactSources: where leads/contacts enter (website forms, paid ads, manual import, etc.)
- pipelineStages: the ordered stages a contact moves through, each with a short description and any manual actions a human must perform at that stage
- integrations: the tools/platforms involved
- goals: a concise summary of the outcome the client wants
- tasks: concrete build tasks for a team member (automations, funnels, forms, integrations)
Be specific and practical. If something is not mentioned, infer sensible defaults for an automation build but keep them minimal. Return only data matching the schema.`;

export async function generateBriefFromNotes(notes: string): Promise<AIBriefDraft> {
  if (!client) throw new Error("OPENAI_API_KEY is not configured");
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Client meeting notes:\n\n${notes.slice(0, 24000)}` },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "build_brief", strict: true, schema: jsonSchema },
    },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("AI returned no content");
  return JSON.parse(raw) as AIBriefDraft;
}
