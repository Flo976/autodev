import { log } from "./log.mjs";

async function confluenceFetch(config, path, options = {}) {
  const base = config.jiraBase.replace(/\/+$/, "");
  const url = `${base}/wiki/api/v2${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Basic ${config.jiraAuth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Confluence ${options.method || "GET"} ${path} → ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export function extractConfluenceLink(description) {
  if (!description) return null;
  const m = description.match(/https?:\/\/[^\s]*\.atlassian\.net\/wiki\/[^\s)>]*/);
  return m ? m[0] : null;
}

function pageIdFromUrl(url) {
  const m = url.match(/\/pages\/(\d+)/);
  return m ? m[1] : null;
}

export function buildReportBody(ticket, evalResult, prUrl) {
  const today = new Date().toISOString().split("T")[0];
  const files = (evalResult.modifiedFiles || []).map((f) => `<li><code>${f}</code></li>`).join("\n");
  const summary = (evalResult.summary || "").substring(0, 500);

  // Use Confluence storage format (XHTML)
  return `<h2>Implementation — ${ticket.key}</h2>
<p><strong>Date</strong> : ${today}<br/>
<strong>PR</strong> : <a href="${prUrl}">${prUrl}</a></p>
<h3>Fichiers modifies</h3>
<ul>${files || "<li>Aucun</li>"}</ul>
<h3>Resume</h3>
<p>${summary || "N/A"}</p>`;
}

export async function publishConfluenceReport(config, ticket, evalResult, prUrl) {
  if (!config.confluence?.spaceKey) {
    return null;
  }

  const reportBody = buildReportBody(ticket, evalResult, prUrl);
  const confluenceLink = extractConfluenceLink(ticket.description || "");

  try {
    if (confluenceLink) {
      const pageId = pageIdFromUrl(confluenceLink);
      if (pageId) {
        const page = await confluenceFetch(config, `/pages/${pageId}?body-format=storage`);
        const currentBody = page.body?.storage?.value || "";
        await confluenceFetch(config, `/pages/${pageId}`, {
          method: "PUT",
          body: JSON.stringify({
            id: pageId,
            status: "current",
            title: page.title,
            body: {
              representation: "storage",
              value: currentBody + "\n\n" + reportBody,
            },
            version: { number: (page.version?.number || 1) + 1 },
          }),
        });
        log(`[CONFLUENCE] Updated page: ${confluenceLink}`);
        return confluenceLink;
      }
    }

    // Create new page
    const newPage = await confluenceFetch(config, `/pages`, {
      method: "POST",
      body: JSON.stringify({
        spaceId: config.confluence.spaceKey,
        status: "current",
        title: `${ticket.key}: ${ticket.summary}`,
        parentId: config.confluence.parentPageId || undefined,
        body: {
          representation: "storage",
          value: reportBody,
        },
      }),
    });

    const base = config.jiraBase.replace(/\/+$/, "");
    const pageUrl = newPage._links?.webui
      ? `${base}/wiki${newPage._links.webui}`
      : `Created page ${newPage.id}`;
    log(`[CONFLUENCE] Created page: ${pageUrl}`);
    return pageUrl;
  } catch (e) {
    log(`[CONFLUENCE] Warning: report failed: ${e.message}`);
    return null;
  }
}
