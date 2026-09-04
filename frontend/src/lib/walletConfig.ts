import { createConfig, http, injected } from "wagmi";
import { testnetBradbury } from "genlayer-js/chains";

// Only the generic injected EIP-1193 connector is exposed. storage: null
// prevents wagmi from persisting application connection state locally.
export const dominionInjectedConnector = injected({ shimDisconnect: false });

export const wagmiConfig = createConfig({
  chains: [testnetBradbury],
  connectors: [dominionInjectedConnector],
  transports: {
    [testnetBradbury.id]: http(testnetBradbury.rpcUrls.default.http[0]),
  },
  multiInjectedProviderDiscovery: false,
  storage: null,
  ssr: true,
});
