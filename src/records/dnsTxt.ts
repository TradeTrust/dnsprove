import { Static, Boolean, String, Literal, Record, Union, Partial } from "runtypes";

export const RecordTypesT = Literal("openatts");

export const BlockchainNetworkT = Literal("ethereum");

export const EthereumAddressT = String.withConstraint((maybeAddress: string) => {
  return /0x[a-fA-F0-9]{40}/.test(maybeAddress) || `${maybeAddress} is not a valid ethereum address`;
});

export enum EthereumNetworks {
  homestead = "1",
  ropsten = "3",
  rinkeby = "4",
  goerli = "5",
  sepolia = "11155111",
  polygon = "137",
  polygonAmoy = "80002",
  local = "1337",
  xdc = "50",
  xdcapothem = "51",
  stabilityTestnet = "20180427",
  stability = "101010",
  astron = "1338",
}

export const EthereumNetworkIdT = Union(
  Literal(EthereumNetworks.homestead),
  Literal(EthereumNetworks.ropsten),
  Literal(EthereumNetworks.rinkeby),
  Literal(EthereumNetworks.goerli),
  Literal(EthereumNetworks.sepolia),
  Literal(EthereumNetworks.polygon),
  Literal(EthereumNetworks.polygonAmoy),
  Literal(EthereumNetworks.xdc),
  Literal(EthereumNetworks.xdcapothem),
  Literal(EthereumNetworks.stabilityTestnet),
  Literal(EthereumNetworks.stability),
  Literal(EthereumNetworks.local),
  Literal(EthereumNetworks.astron)
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
