import type { GithubTarget } from './useGithubTarget'

// The one-time "where does this file go" card, shared by every workspace. The filename is
// stated rather than offered: our software only reads each file under one fixed name, so
// letting anyone retarget it only produces a file the software never reads.
export function GithubTargetCard({ target }: { target: GithubTarget }) {
  return (
    <section className="card">
      <h2>Target file on GitHub</h2>
      <div className="github-row">
        <input value={target.owner} placeholder="owner" aria-label="owner" onChange={(e) => target.setOwner(e.target.value)} />
        <input value={target.repo} placeholder="repo" aria-label="repo" onChange={(e) => target.setRepo(e.target.value)} />
        <input value={target.branch} placeholder="branch" aria-label="branch" onChange={(e) => target.setBranch(e.target.value)} />
        <p className="github-path">
          <code>{target.path}</code>
          <span>fixed filename — this is where our software looks for it</span>
        </p>
      </div>
    </section>
  )
}
