import { Static, Boolean, String, Literal, Record, Partial } from "runtypes";

export const RecordTypesT = Literal("openatts");

export const BlockchainNetworkT = Literal("ethereum");

export const EthereumAddressT = String.withConstraint((maybeAddress: string) => {
  return /0x[a-fA-F0-9]{40}/.test(maybeAddress) || `${maybeAddress} is not a valid ethereum address`;
});

export const EthereumNetworkIdT = String.withConstraint(
  (maybeNetId: string) => /^\d+$/.test(maybeNetId) || `${maybeNetId} is not a valid numeric network id`
);

export const OpenAttestationDNSTextRecordT = Record({
  type: RecordTypesT,
  net: BlockchainNetworkT,
  netId: EthereumNetworkIdT,
  addr: EthereumAddressT,
}).And(Partial({ dnssec: Boolean }));

export type BlockchainNetwork = Static<typeof BlockchainNetworkT>;
export type EthereumAddress = Static<typeof EthereumAddressT>;
export type OpenAttestationDNSTextRecord = Static<typeof OpenAttestationDNSTextRecordT>;
export type RecordTypes = Static<typeof RecordTypesT>;
