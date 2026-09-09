import type { LabProvider } from '../labIngestion';
import { scLabsProvider } from './scLabsProvider';

const providers: Record<string, LabProvider> = {
  [scLabsProvider.id]: scLabsProvider,
};

export function getLabProvider(id: string) {
  return providers[id] || null;
}

export function listLabProviders() {
  return Object.values(providers).map(provider => ({ id: provider.id, name: provider.name }));
}
