import { createApiClient } from '../../../shared/api-client.ts';

// Same origin as the dashboard, so no base URL is needed.
export const api = createApiClient({ baseUrl: '' });
