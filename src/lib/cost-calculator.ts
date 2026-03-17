export type CostLineItem = {
  label: string;
  amountUsd: number;
};

export function calculateTotalCost(lineItems: CostLineItem[]): number {
  return lineItems.reduce((total, item) => total + item.amountUsd, 0);
}
