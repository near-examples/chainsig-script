import { parseUnits } from 'ethers';

export const ORAI = 'orai';
export const COSMOS_CHAIN_IDS = { ORAICHAIN: 'Oraichain' };

// Keep token quantities exact instead of rounding through floating-point units.
export const toAmount = (value: string | number, decimals = 6) => parseUnits(String(value), decimals);
