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
  // The API credential the platform hands you, rendered into an Opaque Secret. Optional: blank
  // means the Secret is left out of the stream entirely rather than emitted with an empty value,
  // because applying `stringData: {api_secret: ""}` would happily overwrite a real secret that is
  // already in the cluster with nothing. An omitted document cannot do that.
  apiSecret?: string
  // Overrides the derived `<tenant>-<product>` name. Optional, and blank means derived - a cluster
  // whose namespaces are already named by some other convention should not have to rename them to
  // use this page, and a tenant/product pair that happens to produce a taken name needs a way out.
  // Tenant and product stay required either way: they are the identity, and they still label the
  // Namespace object. This only renames it.
  namespace?: string
}

// The key inside the Secret's data, and the suffix of its name. Named separately because they are
// the two things a platform team is most likely to want different, and they are guesses today.
export const API_SECRET_KEY = 'api_secret'
export const API_SECRET_SUFFIX = 'api'

export type ManifestResult =
  | { success: true; namespace: string; yaml: string }
  | { success: false; issues: string[] }

export function namespaceFor({ tenant, product, namespace }: ManifestInput): string {
  return namespace?.trim() || `${tenant.trim()}-${product.trim()}`
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

  const namespace = namespaceFor({ tenant, product, namespace: input.namespace })
  const serviceAccounts = SERVICE_ACCOUNT_SUFFIXES.map((suffix) => ({
    suffix,
    name: `${namespace}-${suffix}`,
    secretName: `${namespace}-${suffix}-token`,
  }))
  const roleName = `${namespace}-role`
  const bindingName = `${namespace}-rolebinding`
  const apiSecretName = `${namespace}-${API_SECRET_SUFFIX}`
  const apiSecret = (input.apiSecret ?? '').trim()

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
    // Checked even though `-api` is shorter than every other suffix here and so cannot be the
    // first to overflow today. The point of checking each derived name is that the relative
    // lengths are an accident of the current names, not a property anyone should rely on.
    ...(apiSecret ? nameIssues('API Secret', apiSecretName) : []),
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

    // Only when a value was actually entered - see ManifestInput.apiSecret.
    ...(apiSecret
      ? [
          document(
            [
              `# TODO: confirm the Secret name "${apiSecretName}" and the key "${API_SECRET_KEY}".`,
              '#',
              '# THIS DOCUMENT CONTAINS A SECRET IN PLAIN TEXT. Unlike every other file this tool',
              '# produces, it must NOT be committed to a repository. Pipe it straight to kubectl',
              '# (kubectl apply -f -) rather than saving it, and clear your shell history if you',
              '# pasted it. stringData is used rather than data on purpose: base64 is an encoding,',
              '# not encryption, and writing it out encoded would only make the value look',
              '# protected while being just as readable.',
            ].join('\n'),
            {
              apiVersion: 'v1',
              kind: 'Secret',
              metadata: { name: apiSecretName, namespace },
              type: 'Opaque',
              stringData: { [API_SECRET_KEY]: apiSecret },
            },
          ),
        ]
      : []),

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
