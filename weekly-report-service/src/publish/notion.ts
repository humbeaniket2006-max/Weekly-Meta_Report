type NotionBlock = Record<string, unknown>;

export async function createNotionReportPage(input: {
  weekStart: string;
  weekEnd: string;
  reportUrl: string;
  summaryText: string;
  headlineMetrics: Array<{ label: string; value: string; delta?: string }>;
  gaps: Array<{ label: string; amount: number }>;
}): Promise<void> {
  const apiKey = requiredEnv("NOTION_API_KEY");
  const parentId = requiredEnv("NOTION_PARENT_ID");
  const parentType = process.env.NOTION_PARENT_TYPE ?? "page";
  if (parentType !== "page" && parentType !== "database") {
    throw new Error("NOTION_PARENT_TYPE must be either page or database");
  }

  const children: NotionBlock[] = [
    heading(`Week of ${input.weekStart} to ${input.weekEnd}`),
    paragraph(input.summaryText),
    heading("Headline metrics", "heading_3"),
    ...input.headlineMetrics.map((m) => bulletItem(`${m.label}: ${m.value}${m.delta ? ` (${m.delta})` : ""}`))
  ];

  if (input.gaps.length > 0) {
    children.push(heading("Reconciliation gaps", "heading_3"));
    children.push(...input.gaps.map((g) => bulletItem(`${g.label}: ${g.amount}`)));
  } else {
    children.push(paragraph("All sources reconciled, no gaps this week."));
  }

  children.push(paragraph(""), linkButton("Open full interactive report", input.reportUrl));

  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      parent: parentType === "database" ? { database_id: parentId } : { page_id: parentId },
      properties: {
        title: { title: [{ text: { content: `Weekly Report - ${input.weekStart}` } }] }
      },
      children
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion page creation failed (${res.status}): ${body}`);
  }
}

function heading(text: string, type: "heading_2" | "heading_3" = "heading_2"): NotionBlock {
  return { object: "block", type, [type]: { rich_text: [{ type: "text", text: { content: text } }] } };
}

function paragraph(text: string): NotionBlock {
  return { object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: text } }] } };
}

function bulletItem(text: string): NotionBlock {
  return { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ type: "text", text: { content: text } }] } };
}

function linkButton(text: string, url: string): NotionBlock {
  return { object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: text, link: { url } } }] } };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
