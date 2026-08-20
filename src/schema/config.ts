import { z } from 'zod'

export const TOPIC_METHODS = ['artefact', 'environment', 'script'] as const
export type TopicMethod = (typeof TOPIC_METHODS)[number]

// Matches a domain or a single-level wildcard domain, e.g. "github.com" or "*.github.com".
const DOMAIN_PATTERN =
  /^(\*\.)?[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/

export const proxyEntrySchema = z
  .string()
  .trim()
  .min(1, 'Proxy entry is required')
  .regex(DOMAIN_PATTERN, 'Must be a domain or wildcard domain, e.g. *.github.com')

export const githubTopicSchema = z.object({
  method: z.enum(TOPIC_METHODS),
  name: z.string().trim().min(1, 'Name is required'),
  description: z.string().trim().min(1, 'Description is required'),
})

export const configSchema = z.object({
  tenant: z
    .string()
    .trim()
    .min(1, 'Tenant name is required')
    .max(12, 'Tenant name must be 12 characters or fewer'),
  product: z.string().trim().min(1, 'Product name is required'),
  proxyEntries: z.array(proxyEntrySchema).min(1, 'At least one proxy entry is required'),
  githubTopics: z.array(githubTopicSchema).min(1, 'At least one github topic is required'),
})

export type Config = z.infer<typeof configSchema>
export type GithubTopic = z.infer<typeof githubTopicSchema>
