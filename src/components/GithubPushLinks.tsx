import { buildCreateFileUrl, buildEditFileUrl, type FileExistsResult, type RepoFileLocation } from '../lib/github'

interface GithubPushLinksProps {
  state: 'idle' | 'checking' | FileExistsResult
  location: RepoFileLocation
  content: string
}

// GitHub's /new page takes a prefilled `value=`, but rejects it outright if the file already
// exists, and its /edit page has no equivalent param - so an update can only ever be
// "open the editor and paste". Which of the three hints below shows is decided by the
// existence check; 'unknown' means a private repo or a rate-limited API, where we can't tell.
export function GithubPushLinks({ state, location, content }: GithubPushLinksProps) {
  // Copies the YAML before GitHub's editor opens in the new tab, so the user only has to
  // select-all and paste there instead of also going back to hit "Copy YAML" first.
  function handleOpenToUpdate() {
    void navigator.clipboard.writeText(content)
  }

  if (state === 'missing') {
    return (
      <p className="github-hint">
        <a className="github-link primary" href={buildCreateFileUrl({ ...location, content })} target="_blank" rel="noreferrer">
          Create file on GitHub
        </a>
      </p>
    )
  }

  if (state === 'exists') {
    return (
      <p className="github-hint">
        This file already exists on that branch. GitHub can't prefill an update, so the
        YAML has been copied to your clipboard — in the editor that opens, select all
        (Cmd/Ctrl+A), paste (Cmd/Ctrl+V) to replace the contents, then commit.
        <br />
        <a className="github-link primary" href={buildEditFileUrl(location)} target="_blank" rel="noreferrer" onClick={handleOpenToUpdate}>
          Open file on GitHub to update
        </a>
      </p>
    )
  }

  if (state === 'unknown') {
    return (
      <p className="github-hint">
        Couldn't confirm whether this file exists (private repo, or GitHub's API is
        rate-limited). Use Create if it's new, or Update if it already exists — Update
        copies the YAML to your clipboard first, since GitHub can't prefill an edit.
        <br />
        <a className="github-link primary" href={buildCreateFileUrl({ ...location, content })} target="_blank" rel="noreferrer">
          Create file on GitHub
        </a>{' '}
        <a className="github-link" href={buildEditFileUrl(location)} target="_blank" rel="noreferrer" onClick={handleOpenToUpdate}>
          Open file on GitHub to update
        </a>
      </p>
    )
  }

  return null
}
