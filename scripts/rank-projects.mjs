
// scripts/rank-projects.mjs
//
// Ranks the user's own (non-fork, non-archived) repos by number of commits
// they personally pushed in the last WINDOW_DAYS, then rewrites the block
// between <!-- PROJECTS:START --> and <!-- PROJECTS:END --> in README.md
// with the top TOP_N as detailed cards.
//
// Nothing here is hardcoded to a specific repo name - the ranking is 100%
// derived from live commit data on every run.
//
// Requires Node 20+ (built-in fetch). Run from the repo root:
//   GITHUB_TOKEN=... GITHUB_USER=KiptooMannu node scripts/rank-projects.mjs

import fs from "node:fs";

const USERNAME = process.env.GITHUB_USER || "KiptooMannu";
const TOKEN = process.env.GITHUB_TOKEN;
const TOP_N = Number(process.env.TOP_N || 5);
const WINDOW_DAYS = Number(process.env.WINDOW_DAYS || 90);
const README_PATH = "README.md";
const START_MARKER = "<!-- PROJECTS:START -->";
const END_MARKER = "<!-- PROJECTS:END -->";
const ACCENT = "6E40C9";

if (!TOKEN) {
  console.error("Missing GITHUB_TOKEN environment variable.");
  process.exit(1);
}

const headers = {
  Authorization: "Bearer " + TOKEN,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function ghFetch(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    // 409 = empty repo, 404 = no access/branch missing -> treat as "skip", not fatal
    if (res.status === 409 || res.status === 404) return null;
    const body = await res.text();
    throw new Error("GitHub API " + res.status + " for " + url + ": " + body);
  }
  return res.json();
}

async function listOwnedRepos() {
  const repos = [];
  let page = 1;
  while (true) {
    const url =
      "https://api.github.com/users/" +
      USERNAME +
      "/repos?per_page=100&page=" +
      page +
      "&type=owner&sort=pushed";
    const batch = await ghFetch(url);
    if (!batch || batch.length === 0) break;
    repos.push(...batch.filter((r) => !r.fork && !r.archived));
    if (batch.length < 100) break;
    page++;
  }
  return repos;
}

async function countRecentCommits(repo, sinceISO) {
  let page = 1;
  let count = 0;
  while (true) {
    const url =
      "https://api.github.com/repos/" +
      USERNAME +
      "/" +
      repo.name +
      "/commits?author=" +
      USERNAME +
      "&since=" +
      sinceISO +
      "&per_page=100&page=" +
      page;
    const batch = await ghFetch(url);
    if (!batch || batch.length === 0) break;
    count += batch.length;
    if (batch.length < 100) break;
    page++;
  }
  return count;
}

function badge(label, value, opts) {
  opts = opts || {};
  const color = opts.color || ACCENT;
  const style = opts.style || "flat-square";
  const logo = opts.logo ? "&logo=" + opts.logo + "&logoColor=white" : "";
  const labelEnc = encodeURIComponent(label);
  const valueEnc = encodeURIComponent(String(value));
  return (
    "![" +
    label +
    "](https://img.shields.io/badge/" +
    labelEnc +
    "-" +
    valueEnc +
    "-" +
    color +
    "?style=" +
    style +
    logo +
    ")"
  );
}

function renderCard(repo, commitCount, rank) {
  const desc = repo.description ? repo.description.trim() : "No description set on this repo yet.";
  const lang = repo.language || "mixed";
  const topics = (repo.topics || []).slice(0, 6);

  const links = [
    "[![Source](https://img.shields.io/badge/Source-Repository-181717?style=for-the-badge&logo=github&logoColor=white)](" +
      repo.html_url +
      ")",
  ];
  if (repo.homepage) {
    links.push(
      "[![Live Demo](https://img.shields.io/badge/LIVE_DEMO-View_App-" +
        ACCENT +
        "?style=for-the-badge)](" +
        repo.homepage +
        ")"
    );
  }

  const liveBadges = [
    "[![Stars](https://img.shields.io/github/stars/" +
      USERNAME +
      "/" +
      repo.name +
      "?style=flat-square&color=" +
      ACCENT +
      "&label=Stars)](" +
      repo.html_url +
      "/stargazers)",
    "[![Forks](https://img.shields.io/github/forks/" +
      USERNAME +
      "/" +
      repo.name +
      "?style=flat-square&color=" +
      ACCENT +
      "&label=Forks)](" +
      repo.html_url +
      "/network/members)",
    "[![Last Commit](https://img.shields.io/github/last-commit/" +
      USERNAME +
      "/" +
      repo.name +
      "?style=flat-square&color=" +
      ACCENT +
      "&label=Last%20Commit)](" +
      repo.html_url +
      "/commits)",
    "[![Issues](https://img.shields.io/github/issues/" +
      USERNAME +
      "/" +
      repo.name +
      "?style=flat-square&color=" +
      ACCENT +
      "&label=Open%20Issues)](" +
      repo.html_url +
      "/issues)",
  ].join("\n");

  const topicBadges = topics.map((t) => badge(t, "topic", { color: "2d2d44" })).join(" ");

  const lines = [];
  lines.push("");
  lines.push("### #" + rank + " - " + repo.name);
  lines.push("");
  lines.push(desc);
  lines.push("");
  lines.push('<div align="left">');
  lines.push("");
  lines.push(links.join("\n"));
  lines.push("");
  lines.push(liveBadges);
  lines.push("");
  lines.push("</div>");
  lines.push("");
  lines.push(
    badge("Commits (" + WINDOW_DAYS + "d)", commitCount, { color: ACCENT }) +
      " " +
      badge("Language", lang, { color: "2d2d44" })
  );
  if (topicBadges) lines.push(topicBadges);

  return lines.join("\n");
}

async function main() {
  const sinceISO = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const repos = await listOwnedRepos();

  const ranked = [];
  for (const repo of repos) {
    const commitCount = await countRecentCommits(repo, sinceISO);
    if (commitCount > 0) ranked.push({ repo, commitCount });
  }
  ranked.sort((a, b) => b.commitCount - a.commitCount);
  const top = ranked.slice(0, TOP_N);

  let body;
  if (top.length === 0) {
    body =
      "No commits found in the last " +
      WINDOW_DAYS +
      " days - push some commits and this section will populate on the next run.";
  } else {
    const header =
      "> Ranked by commits pushed in the last " +
      WINDOW_DAYS +
      " days - regenerated " +
      new Date().toISOString().slice(0, 10) +
      "\n";
    const cards = top.map((entry, i) => renderCard(entry.repo, entry.commitCount, i + 1)).join("\n---\n");
    body = header + cards;
  }

  const readme = fs.readFileSync(README_PATH, "utf8");
  const startIdx = readme.indexOf(START_MARKER);
  const endIdx = readme.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error("Could not find " + START_MARKER + " / " + END_MARKER + " markers in " + README_PATH);
  }

  const updated =
    readme.slice(0, startIdx + START_MARKER.length) +
    "\n<!-- This block is regenerated automatically - do not edit by hand, your edits will be overwritten on the next run. -->\n\n" +
    body +
    "\n\n" +
    readme.slice(endIdx);

  fs.writeFileSync(README_PATH, updated);
  console.log("Wrote top " + top.length + " repo(s) ranked by commit activity.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
