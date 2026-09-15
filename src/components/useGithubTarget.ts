import { useState } from 'react'
import { checkFileExists, inferRepoFromPagesUrl, type FileExistsResult, type RepoFileLocation } from '../lib/github'
import { usePersistedState } from '../lib/persisted-state'

export interface GithubTarget {
  owner: string
  repo: string
  branch: string
  path: string
  setOwner: (value: string) => void
  setRepo: (value: string) => void
  setBranch: (value: string) => void
  location: RepoFileLocation
  canFetch: boolean
  // Already staleness-corrected: reverts to 'idle' as soon as the target fields move away from
  // the location the check was actually run for.
  checkState: 'idle' | 'checking' | FileExistsResult
  runCheck: () => Promise<void>
}

// owner/repo/branch are shared across every file this tool writes (same target repo). Served
// from GitHub Pages, the hosting repo is readable off the URL and is the repo these files
// belong to, so owner/repo start filled in instead of blank - as a first value only, not a
// lock: it's still persisted state, so editing either one sticks.
export function useGithubTarget(path: string): GithubTarget {
  const [owner, setOwner] = usePersistedState('github-owner', () => inferRepoFromPagesUrl(window.location.href)?.owner ?? '')
  const [repo, setRepo] = usePersistedState('github-repo', () => inferRepoFromPagesUrl(window.location.href)?.repo ?? '')
  const [branch, setBranch] = usePersistedState('github-branch', 'main')

  const [checkState, setCheckState] = useState<'idle' | 'checking' | FileExistsResult>('idle')
  // The location a check was last run for. Once the target fields change, the check is stale
  // and we fall back to 'idle' during render rather than syncing state via an effect.
  const [checkedKey, setCheckedKey] = useState<string | null>(null)

  const location = { owner: owner.trim(), repo: repo.trim(), branch: branch.trim() || 'main', path: path.trim() }
  const locationKey = `${location.owner}|${location.repo}|${location.branch}|${location.path}`
  const canFetch = Boolean(owner.trim() && repo.trim() && path.trim())

  async function runCheck() {
    setCheckState('checking')
    setCheckedKey(locationKey)
    const status = await checkFileExists(location)
    setCheckState(status)
  }

  return {
    owner,
    repo,
    branch,
    path,
    setOwner,
    setRepo,
    setBranch,
    location,
    canFetch,
    checkState: checkedKey === locationKey ? checkState : 'idle',
    runCheck,
  }
}
