import YAML from 'yaml'

// PLACEHOLDER CONTENT - see docs/kubernetes-resources.md and CLAUDE.md.
//
// The *shape* here (a namespace, two service accounts, a Role, a RoleBinding, and a token
// Secret per service account) is what was described; the RBAC rules, the service account
// names and the secret contents are invented and marked TODO in the rendered output. Nobody
// should apply this to a real cluster before the rules below are confirmed - which is exactly
// why every guessed value carries a visible `# TODO: confirm` rather than looking authoritative.
const SERVICE_ACCOUNT_SUFFIXES = ['deployer', 'reader'] as const

// Kubernetes object names are DNS-1123 labels. Tenant and product are free text on the way in,
// so a name is checked rather than assumed: emitting a manifest that kubectl will reject (or
// worse, one that silently names the wrong thing) is not a useful thing to hand someone.
const DNS_1123_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/
const MAX_NAME_LENGTH = 63

export interface ManifestInput {
  tenant: string
  product: string
}

export type ManifestResult =
  | { success: true; namespace: string; yaml: string }
  | { success: false; issues: string[] }

export function namespaceFor({ tenant, product }: ManifestInput): string {
  return `${tenant.trim()}-${product.trim()}`
}

function nameIssues(label: string, value: string): string[] {
  const issues: string[] = []
  if (value.length > MAX_NAME_LENGTH) {
    issues.push(`${label} "${value}" is ${value.length} characters; Kubernetes names are limited to ${MAX_NAME_LENGTH}.`)
  }
  if (!DNS_1123_LABEL.test(value)) {
    issues.push(`${label} "${value}" isn't a valid Kubernetes name: use lowercase letters, digits and hyphens, starting and ending with a letter or digit.`)
  }
  return issues
}

// A header comment per document, so the placeholder warning survives copy/paste into a terminal
// rather than living only in this app's UI.
function document(comment: string, resource: unknown): string {
  return `${comment}\n${YAML.stringify(resource)}`.trimEnd()
}

export function renderManifests(input: ManifestInput): ManifestResult {
  const tenant = input.tenant.trim()
  const product = input.product.trim()

  if (!tenant || !product) {
    return { success: false, issues: ['Enter a tenant and a product to render the resources.'] }
  }

  const namespace = namespaceFor({ tenant, product })
  const serviceAccounts = SERVICE_ACCOUNT_SUFFIXES.map((suffix) => ({
    suffix,
    name: `${namespace}-${suffix}`,
    secretName: `${namespace}-${suffix}-token`,
  }))
  const roleName = `${namespace}-role`
  const bindingName = `${namespace}-rolebinding`

  // The namespace first, and alone: every other name is derived from it, so a bad character in
  // the tenant would otherwise be reported six times over with the fix buried in the repetition.
  const namespaceIssues = nameIssues('Namespace', namespace)
  if (namespaceIssues.length > 0) return { success: false, issues: namespaceIssues }

  // Then the derived names, which can only fail on length now - and they do fail independently:
  // a token Secret's name is 6 characters longer than its service account's, so a namespace
  // short enough for one can still overflow the other, and checking only the shorter name would
  // emit a manifest kubectl rejects.
  const issues = [
    ...serviceAccounts.flatMap((sa) => [...nameIssues('Service account', sa.name), ...nameIssues('Secret', sa.secretName)]),
    ...nameIssues('Role', roleName),
    ...nameIssues('RoleBinding', bindingName),
  ]
  if (issues.length > 0) return { success: false, issues }

  const documents = [
    document('# PLACEHOLDER - confirm every value below before applying to a real cluster.', {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: { name: namespace, labels: { tenant, product } },
    }),

    ...serviceAccounts.map((sa) =>
      document(`# TODO: confirm this service account is named "${sa.suffix}" and is created here rather than by the platform.`, {
        apiVersion: 'v1',
        kind: 'ServiceAccount',
        metadata: { name: sa.name, namespace },
      }),
    ),

    document('# TODO: confirm these rules. They are a placeholder, not the real permission set.', {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'Role',
      metadata: { name: roleName, namespace },
      rules: [
        { apiGroups: [''], resources: ['pods', 'services', 'configmaps'], verbs: ['get', 'list', 'watch'] },
        { apiGroups: ['apps'], resources: ['deployments'], verbs: ['get', 'list', 'watch'] },
      ],
    }),

    document('# TODO: confirm both service accounts should hold the same Role.', {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'RoleBinding',
      metadata: { name: bindingName, namespace },
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: roleName },
      subjects: serviceAccounts.map((sa) => ({ kind: 'ServiceAccount', name: sa.name, namespace })),
    }),

    ...serviceAccounts.map((sa) =>
      document(`# TODO: confirm a long-lived token is wanted here at all - on 1.24+ these are not created automatically,\n# and a short-lived projected token is usually preferred.`, {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: {
          name: sa.secretName,
          namespace,
          annotations: { 'kubernetes.io/service-account.name': sa.name },
        },
        type: 'kubernetes.io/service-account-token',
      }),
    ),
  ]

  return { success: true, namespace, yaml: `${documents.join('\n---\n')}\n` }
}
