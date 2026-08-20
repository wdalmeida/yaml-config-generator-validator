export interface RepoFileLocation {
  owner: string
  repo: string
  branch: string
  path: string
}

export interface CreateFileLinkOptions extends RepoFileLocation {
  content: string
}

// Builds a GitHub "create new file" URL prefilled with a path and content.
// The user still reviews and commits the file themselves while logged into GitHub -
// no OAuth or token handling needed. See: https://github.com/<owner>/<repo>/new/<branch>
// GitHub rejects this with "A file with the same name already exists" if the path is
// already tracked on that branch - use buildEditFileUrl instead for that case.
export function buildCreateFileUrl({ owner, repo, branch, path, content }: CreateFileLinkOptions): string {
  const base = `https://github.com/${owner}/${repo}/new/${branch}`
  const params = new URLSearchParams({ filename: path, value: content })
  return `${base}?${params.toString()}`
}

// Opens GitHub's editor for an already-existing file. GitHub does not support prefilling
// replacement content here (no `value` param like the /new page) - the user has to paste
// the generated YAML in themselves, replacing what's there.
export function buildEditFileUrl({ owner, repo, branch, path }: RepoFileLocation): string {
  const encodedPath = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `https://github.com/${owner}/${repo}/edit/${branch}/${encodedPath}`
}

export type FileExistsResult = 'exists' | 'missing' | 'unknown'

// Uses GitHub's public contents API (unauthenticated, works for public repos) to tell
// whether `path` already exists on `branch`.
//
// GitHub returns a plain 404 both for "path doesn't exist in this repo" and for "this repo
// is private/doesn't exist" (it never reveals a private repo's existence to an unauthenticated
// caller) - the two are indistinguishable from the contents endpoint alone. So we first check
// whether the repo itself is visible; only if it is do we trust a 404 on the path as "missing".
// Otherwise (private repo, or rate-limited) we report "unknown".
export async function checkFileExists({ owner, repo, branch, path }: RepoFileLocation): Promise<FileExistsResult> {
  const repoUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  const encodedPath = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  const contentsUrl = `${repoUrl}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`

  try {
    const repoRes = await fetch(repoUrl, { headers: { Accept: 'application/vnd.github+json' } })
    if (repoRes.status !== 200) return 'unknown'

    const fileRes = await fetch(contentsUrl, { headers: { Accept: 'application/vnd.github+json' } })
    if (fileRes.status === 200) return 'exists'
    if (fileRes.status === 404) return 'missing'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}
