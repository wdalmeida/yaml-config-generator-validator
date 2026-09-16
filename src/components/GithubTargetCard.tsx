import type { GithubTarget } from './useGithubTarget'

// The one-time "where does this file go" card, shared by every workspace. The filename is
// stated rather than offered: our software only reads each file under one fixed name, so
// letting anyone retarget it only produces a file the software never reads.
export function GithubTargetCard({ target }: { target: GithubTarget }) {
  return (
    <section className="card">
      <h2>Target file on GitHub</h2>
      {/* aria-label rather than a visible <label> because the three sit inline as one path and
          the placeholders carry the visual labelling. The names are spelled out rather than
          echoing the placeholder: "owner" alone is not much use read aloud on its own. */}
      <div className="github-row">
        <input
          value={target.owner}
          placeholder="owner"
          aria-label="Repository owner"
          onChange={(e) => target.setOwner(e.target.value)}
        />
        <input
          value={target.repo}
          placeholder="repo"
          aria-label="Repository name"
          onChange={(e) => target.setRepo(e.target.value)}
        />
        <input
          value={target.branch}
          placeholder="branch"
          aria-label="Branch"
          onChange={(e) => target.setBranch(e.target.value)}
        />
        <p className="github-path">
          <code>{target.path}</code>
          <span>fixed filename — this is where our software looks for it</span>
        </p>
      </div>
    </section>
  )
}
