import type { ModelRate } from '../domain/cost';

export interface PricingProvider {
  rateFor(model: string): Promise<ModelRate | undefined>;
}
