// Existing tenants a user can pick instead of typing a new one.
// Update this list as tenants are created/retired. Each name must stay <= 12 characters
// to satisfy the tenant schema in src/schema/config.ts.
export const EXISTING_TENANTS = ['acme', 'globex', 'initech'] as const
