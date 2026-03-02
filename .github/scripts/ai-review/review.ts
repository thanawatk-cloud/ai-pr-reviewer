import Anthropic from "@anthropic-ai/sdk";
import { Octokit } from "@octokit/rest";

const MAX_PATCH_CHARS = 80_000; // ~20k tokens per file patch

const EXCLUDED_PATTERNS = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.min\.(js|css)$/,
  /dist\//,
  /build\//,
  /node_modules\//,
  /\.snap$/,
];

interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

async function getPRFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<PRFile[]> {
  const files: PRFile[] = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
      page,
    });

    if (data.length === 0) break;
    files.push(...data);
    if (data.length < 100) break;
    page++;
  }

  return files;
}

function buildDiffContent(files: PRFile[]): string {
  const lines: string[] = [];
  let totalChars = 0;
  let truncated = false;

  for (const file of files) {
    if (!file.patch) continue;

    const header = `\n--- ${file.filename} (${file.status}, +${file.additions}/-${file.deletions}) ---\n`;
    const patch =
      file.patch.length > MAX_PATCH_CHARS
        ? file.patch.slice(0, MAX_PATCH_CHARS) +
          "\n[... patch truncated due to size ...]"
        : file.patch;

    const chunk = header + patch;

    if (totalChars + chunk.length > 200_000) {
      truncated = true;
      break;
    }

    lines.push(chunk);
    totalChars += chunk.length;
  }

  if (truncated) {
    lines.push(
      "\n[... remaining files omitted — PR is very large. Review above files only. ...]"
    );
  }

  return lines.join("\n");
}

async function findExistingReviewComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<number | null> {
  const { data: comments } = await octokit.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
  });

  const existing = comments.find(
    (c) =>
      c.user?.type === "Bot" && c.body?.startsWith("## 🤖 AI Code Review")
  );

  return existing?.id ?? null;
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const prNumber = parseInt(process.env.PR_NUMBER ?? "0");
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "").split("/");

  if (!token || !apiKey || !prNumber || !owner || !repo) {
    throw new Error(
      "Missing required env vars: GITHUB_TOKEN, ANTHROPIC_API_KEY, PR_NUMBER, GITHUB_REPOSITORY"
    );
  }

  const octokit = new Octokit({ auth: token });
  const anthropic = new Anthropic({ apiKey });

  // Get PR metadata
  const { data: pr } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  console.log(`Reviewing PR #${prNumber}: ${pr.title}`);

  // Get PR files
  const allFiles = await getPRFiles(octokit, owner, repo, prNumber);
  const files = allFiles.filter(
    (f) =>
      f.status !== "removed" &&
      !EXCLUDED_PATTERNS.some((pattern) => pattern.test(f.filename))
  );
  console.log(`Found ${allFiles.length} changed files, reviewing ${files.length} after filtering`);

  if (files.length === 0) {
    console.log("No reviewable files after filtering. Skipping.");
    return;
  }

  const diff = buildDiffContent(files);

  if (!diff.trim()) {
    console.log("No reviewable diff found. Skipping.");
    return;
  }

  const filesSummary = files
    .map((f) => `- \`${f.filename}\` (${f.status}, +${f.additions}/-${f.deletions})`)
    .join("\n");

  const systemPrompt = `You are an expert code reviewer with deep knowledge of software engineering best practices, security, and performance.

Your review should be:
- **Constructive and actionable** — suggest specific improvements, not just point out problems
- **Prioritized** — focus on what matters most
- **Concise** — avoid padding; skip sections if there's nothing meaningful to say

Format your review using these sections (omit any section with nothing to add):

## Summary
Brief, 1-2 sentence description of what this PR does.

## Issues
List problems found, each with a severity label:
- 🔴 **Critical** — bugs, security vulnerabilities, data loss risks
- 🟡 **Major** — logic errors, performance problems, missing error handling
- 🟢 **Minor** — style, naming, small improvements

Reference specific file and line numbers from the diff. Provide code examples when helpful.

## Strengths
What's done well (only if genuinely noteworthy).

## Suggestions
Optional improvements that aren't issues — refactoring ideas, alternatives to consider.

## Verdict
One of: ✅ **Approve** | 🔁 **Request Changes** | 💬 **Comment**
Followed by one sentence explaining why.`;

  const userMessage = `**PR #${prNumber}: ${pr.title}**

${pr.body ? `**Description:**\n${pr.body}\n\n` : ""}**Changed files (${files.length}):**
${filesSummary}

**Diff:**
\`\`\`diff
${diff}
\`\`\``;

  console.log("Sending to Claude for review...");

  // Use streaming to handle potentially long reviews
  const stream = anthropic.messages.stream({
    model: "claude-opus-4-6",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const finalMessage = await stream.finalMessage();

  const reviewText = finalMessage.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");

  const commentBody = `## 🤖 AI Code Review

${reviewText}

---
*Reviewed by Claude \`${finalMessage.model}\` — AI-generated, always use your own judgment.*`;

  // Update existing comment or create new one
  const existingId = await findExistingReviewComment(
    octokit,
    owner,
    repo,
    prNumber
  );

  if (existingId) {
    await octokit.issues.updateComment({
      owner,
      repo,
      comment_id: existingId,
      body: commentBody,
    });
    console.log(`✅ Updated existing review comment (id: ${existingId})`);
  } else {
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: commentBody,
    });
    console.log(`✅ Posted new review comment on PR #${prNumber}`);
  }
}

main().catch((err) => {
  console.error("❌ Review failed:", err.message);
  process.exit(1);
});
