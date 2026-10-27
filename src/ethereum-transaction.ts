import { Transaction, keccak256, getBytes, recoverAddress } from 'ethers';

/** Preserve the EIP-155 legacy transaction format used by the proxy contract. */
export function prepareLegacyTransaction(baseTx) {
    const unsignedTx = Transaction.from({ ...baseTx, type: 0 }).unsignedSerialized;
    const hash = keccak256(unsignedTx);
    return { unsignedTx, payload: Array.from(getBytes(hash)), hash };
}

export function finalizeLegacyTransaction(baseTx, sender: string, signature: { r: string; s: string }) {
    const { hash } = prepareLegacyTransaction(baseTx);
    for (const v of [27, 28]) {
        const candidate = { r: signature.r, s: signature.s, v };
        if (recoverAddress(hash, candidate).toLowerCase() === sender.toLowerCase()) {
            return Transaction.from({ ...baseTx, type: 0, signature: candidate }).serialized;
        }
    }
    throw new Error('Signature failed to recover the sending address');
}
