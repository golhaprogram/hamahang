// Open a pull request that adds or updates one file, using the GitHub REST API
// from the browser (api.github.com allows CORS). Needs a token that can write
// contents and open pull requests on the target repo, e.g. a fine-grained
// personal access token scoped to that one repo with
// "Contents: read and write" and "Pull requests: read and write".

const API = "https://api.github.com";

export async function openPullRequest({
  token,
  repo, // "owner/name"
  path, // e.g. "static/lyrics/golhaye-rangarang/256.vtt"
  content, // file text
  base = null, // defaults to the repo's default branch
  branch = null,
  title = null,
  body = "",
  message = null,
  fetchImpl = globalThis.fetch,
}) {
  if (!token) throw new Error("A GitHub token is required.");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || "")) throw new Error(`Invalid repo: ${repo}`);
  if (!path || path.startsWith("/") || path.includes("..")) throw new Error(`Invalid path: ${path}`);

  const gh = async (method, url, data) => {
    const res = await fetchImpl(`${API}${url}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (res.status === 404 && method === "GET") return null;
    const json = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`GitHub ${method} ${url} failed (${res.status}): ${json.message || res.statusText}`);
    }
    return json;
  };

  const encPath = path.split("/").map(encodeURIComponent).join("/");
  const info = await gh("GET", `/repos/${repo}`);
  if (!info) throw new Error(`Repo ${repo} not found, or the token can't see it.`);
  const baseBranch = base || info.default_branch;

  const ref = await gh("GET", `/repos/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`);
  if (!ref) throw new Error(`Branch ${baseBranch} not found in ${repo}.`);

  const fileName = path.split("/").pop();
  const headBranch = branch || `hamahang/${fileName.replace(/[^\w.-]+/g, "-")}-${stamp()}`;
  await gh("POST", `/repos/${repo}/git/refs`, { ref: `refs/heads/${headBranch}`, sha: ref.object.sha });

  const existing = await gh("GET", `/repos/${repo}/contents/${encPath}?ref=${encodeURIComponent(headBranch)}`);
  const verb = existing ? "Update" : "Add";
  await gh("PUT", `/repos/${repo}/contents/${encPath}`, {
    message: message || `${verb} ${path}`,
    content: base64Utf8(content),
    branch: headBranch,
    ...(existing?.sha ? { sha: existing.sha } : {}),
  });

  const pr = await gh("POST", `/repos/${repo}/pulls`, {
    title: title || `${verb} ${fileName}`,
    head: headBranch,
    base: baseBranch,
    body,
  });
  return { url: pr.html_url, number: pr.number, branch: headBranch };
}

export function base64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}
