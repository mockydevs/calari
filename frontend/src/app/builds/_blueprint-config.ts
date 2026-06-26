// Config-driven schema for the admin "edit blueprint" UI. One entry per editable
// blueprint section. Shared by the server actions (payload coercion) and the
// client editor (field rendering) so the two never drift. `build` is attached
// automatically on create — don't list it here.

export type BlueprintField = {
  name: string;
  label: string;
  input: "text" | "textarea" | "number" | "bool" | "stage" | "select";
  options?: { value: string; label: string }[];
  full?: boolean; // span the full row width
};

export type BlueprintSection = {
  path: string; // API path under /api/builds/
  singular: string; // label for the "Add" button
  titleField: string; // field used as the row heading
  fields: BlueprintField[];
};

const opt = (...vals: [string, string][]) => vals.map(([value, label]) => ({ value, label }));

const WORKFLOW_CATEGORY = opt(
  ["ACTIVE_CONVERSION", "Active conversion (A)"],
  ["INTAKE_ROUTING", "Intake & routing (IN)"],
  ["RECORD_KEEPING", "Record-keeping (REC)"],
  ["APPOINTMENT_LIFECYCLE", "Appointment lifecycle (E, K)"],
  ["POST_VISIT", "Post-visit & retention (G)"],
  ["INTERNAL_UTILITY", "Internal & utility (H, X, Y, Z)"],
  ["OTHER", "Other"],
);
const CALENDAR_TYPE = opt(
  ["ROUND_ROBIN", "Round robin"], ["COLLECTIVE", "Collective"], ["CLASS", "Class / group"],
  ["SERVICE", "Service"], ["PERSONAL", "Personal"], ["OTHER", "Other"],
);
const DIRECTION = opt(["INBOUND", "Inbound"], ["OUTBOUND", "Outbound"], ["BIDIRECTIONAL", "Bidirectional"]);
const MECHANISM = opt(
  ["API", "API"], ["WEBHOOK", "Webhook"], ["NATIVE", "Native"], ["ZAPIER", "Zapier / Make"],
  ["CRON", "Scheduled (cron)"], ["OTHER", "Other"],
);
const SOURCE_TYPE = opt(["WEBSITE", "Website"], ["ADS", "Ads"], ["MANUAL", "Manual"], ["OTHER", "Other"]);
const FIELD_KIND = opt(["FIELD", "Custom field"], ["VALUE", "Custom value"]);
const TASK_TYPE = opt(
  ["AUTOMATION", "Automation"], ["FUNNEL", "Funnel"], ["FORM", "Form"],
  ["INTEGRATION", "Integration"], ["OTHER", "Other"],
);

export const BLUEPRINT_SECTIONS: Record<string, BlueprintSection> = {
  stage: {
    path: "builds/pipeline-stages", singular: "stage", titleField: "name",
    fields: [
      { name: "name", label: "Stage name", input: "text" },
      { name: "order", label: "Order", input: "number" },
      { name: "description", label: "What it means", input: "textarea", full: true },
      { name: "entry_condition", label: "How a lead gets here", input: "textarea", full: true },
      { name: "is_automatic", label: "Auto-advances", input: "bool" },
    ],
  },
  workflow: {
    path: "builds/workflows", singular: "workflow", titleField: "name",
    fields: [
      { name: "code", label: "Code", input: "text" },
      { name: "name", label: "Workflow name", input: "text" },
      { name: "category", label: "Category", input: "select", options: WORKFLOW_CATEGORY },
      { name: "trigger", label: "Trigger", input: "text", full: true },
      { name: "what_it_does", label: "What it does", input: "textarea", full: true },
      { name: "patient_facing", label: "Patient-facing", input: "bool" },
      { name: "order", label: "Order", input: "number" },
    ],
  },
  transition: {
    path: "builds/stage-transitions", singular: "transition", titleField: "trigger",
    fields: [
      { name: "from_stage", label: "From stage", input: "stage" },
      { name: "to_stage", label: "To stage", input: "stage" },
      { name: "trigger", label: "Trigger", input: "text", full: true },
      { name: "is_automatic", label: "Automatic", input: "bool" },
      { name: "order", label: "Order", input: "number" },
    ],
  },
  leadsource: {
    path: "builds/contact-sources", singular: "lead source", titleField: "label",
    fields: [
      { name: "label", label: "Label", input: "text" },
      { name: "type", label: "Type", input: "select", options: SOURCE_TYPE },
      { name: "entry_mechanism", label: "How it enters", input: "text" },
      { name: "fires", label: "Fires", input: "text" },
      { name: "tags_applied", label: "Tags applied", input: "text" },
      { name: "handling_workflow", label: "Workflow code", input: "text" },
      { name: "entry_stage", label: "Entry stage", input: "stage" },
      { name: "notes", label: "Notes", input: "textarea", full: true },
      { name: "order", label: "Order", input: "number" },
    ],
  },
  calendar: {
    path: "builds/calendars", singular: "calendar", titleField: "name",
    fields: [
      { name: "name", label: "Calendar name", input: "text" },
      { name: "type", label: "Type", input: "select", options: CALENDAR_TYPE },
      { name: "purpose", label: "Books (purpose)", input: "text" },
      { name: "assigned_to", label: "Assigned to", input: "text" },
      { name: "books_into_stage", label: "Books into stage", input: "stage" },
      { name: "on_booking", label: "On booking", input: "text" },
      { name: "reminders", label: "Reminders", input: "text" },
      { name: "notes", label: "Notes", input: "textarea", full: true },
      { name: "order", label: "Order", input: "number" },
    ],
  },
  integration: {
    path: "builds/integrations", singular: "integration", titleField: "name",
    fields: [
      { name: "name", label: "System", input: "text" },
      { name: "direction", label: "Direction", input: "select", options: DIRECTION },
      { name: "mechanism", label: "Mechanism", input: "select", options: MECHANISM },
      { name: "data_objects", label: "Data objects", input: "text" },
      { name: "purpose", label: "Purpose", input: "text", full: true },
      { name: "trigger_cadence", label: "Cadence", input: "text" },
      { name: "notes", label: "Notes", input: "textarea", full: true },
      { name: "order", label: "Order", input: "number" },
    ],
  },
  customfield: {
    path: "builds/custom-fields", singular: "field/value", titleField: "key",
    fields: [
      { name: "key", label: "Key", input: "text" },
      { name: "kind", label: "Kind", input: "select", options: FIELD_KIND },
      { name: "description", label: "Description", input: "text", full: true },
      { name: "populated", label: "Populated", input: "bool" },
      { name: "order", label: "Order", input: "number" },
    ],
  },
  tag: {
    path: "builds/tags", singular: "tag", titleField: "tag",
    fields: [
      { name: "tag", label: "Tag", input: "text" },
      { name: "meaning", label: "Meaning", input: "text", full: true },
      { name: "order", label: "Order", input: "number" },
    ],
  },
  prelaunch: {
    path: "builds/pre-launch-items", singular: "item", titleField: "description",
    fields: [
      { name: "description", label: "Description", input: "text", full: true },
      { name: "optional", label: "Optional", input: "bool" },
      { name: "done", label: "Done", input: "bool" },
      { name: "order", label: "Order", input: "number" },
    ],
  },
  task: {
    path: "builds/tasks", singular: "task", titleField: "title",
    fields: [
      { name: "title", label: "Task title", input: "text", full: true },
      { name: "type", label: "Type", input: "select", options: TASK_TYPE },
      { name: "description", label: "Description / SOP", input: "textarea", full: true },
    ],
  },
};

export type BlueprintResource = keyof typeof BLUEPRINT_SECTIONS;
