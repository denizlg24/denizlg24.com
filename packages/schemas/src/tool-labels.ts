export const TOOL_LABELS: Record<string, string> = {
  create_blog: "Creating blog post",
  create_calendar_event: "Creating calendar event",
  create_group: "Creating group",
  create_kanban_board: "Creating kanban board",
  create_kanban_card: "Creating kanban card",
  create_kanban_column: "Creating kanban column",
  create_note: "Creating note",
  create_resource: "Creating resource",
  create_timetable_entry: "Creating timetable entry",
  delete_blog: "Deleting blog post",
  delete_calendar_event: "Deleting calendar event",
  delete_email: "Deleting email",
  delete_group: "Deleting group",
  delete_kanban_board: "Deleting kanban board",
  delete_kanban_card: "Deleting kanban card",
  delete_kanban_column: "Deleting kanban column",
  delete_note: "Deleting note",
  delete_resource: "Deleting resource",
  delete_timetable_entry: "Deleting timetable entry",
  generate_email_draft: "Drafting email",
  get_blog: "Read blog post",
  get_calendar_events: "Fetched calendar events",
  get_contact: "Read contact",
  get_email: "Read email",
  get_github_repository_context: "Inspected GitHub repository",
  get_healthy_resources: "Fetched healthy resources",
  get_kanban_board: "Fetched kanban board",
  get_note: "Read note",
  get_now_page: "Fetched now page",
  get_project: "Read project",
  get_resource_by_id: "Fetched resource",
  get_resource_health: "Checked resource health",
  get_resources: "Fetched resources",
  get_timetable: "Fetched timetable",
  list_account_emails: "Listed account emails",
  list_blogs: "Listed blog posts",
  list_contacts: "Listed contacts",
  list_email_accounts: "Listed email accounts",
  list_emails: "Listed emails",
  list_groups: "Listed groups",
  list_kanban_boards: "Listed kanban boards",
  list_kanban_cards: "Listed kanban cards",
  list_kanban_columns: "Listed kanban columns",
  list_notes: "Listed notes",
  list_projects: "Listed projects",
  list_timeline_items: "Fetched timeline",
  mark_email_as_read: "Marking email as read",
  reboot_resource: "Rebooting resource",
  reorder_kanban_cards: "Reordering kanban cards",
  reply_to_contact: "Replying to contact",
  request_send_email: "Requesting email send",
  restart_resource_service: "Restarting service",
  save_project_draft: "Saving project draft",
  search_blogs: "Searched blogs",
  search_notes: "Searched notes",
  semantic_classify_note: "Classifying note",
  update_blog: "Updating blog post",
  update_calendar_event: "Updating calendar event",
  update_contact_status: "Updating contact status",
  update_group: "Updating group",
  update_kanban_board: "Updating kanban board",
  update_kanban_card: "Updating kanban card",
  update_kanban_column: "Updating kanban column",
  update_note: "Updating note",
  update_now_page: "Updating now page",
  update_resource: "Updating resource",
  update_timetable_entry: "Updating timetable entry",
  web_search: "Searched the web",
};

export function getToolLabel(toolName: string) {
  return TOOL_LABELS[toolName] ?? humanizeToolName(toolName);
}

function humanizeToolName(toolName: string) {
  const words = toolName
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!words) return "Using tool";
  return words.charAt(0).toUpperCase() + words.slice(1);
}
