import { createConfig, http, injected } from "wagmi";
import { testnetBradbury } from "genlayer-js/chains";

// Only the generic injected EIP-1193 connector is exposed. storage: null
// prevents wagmi from persisting application connection state locally. Since
// there is no persistence store, keep wagmi out of its SSR rehydration path.
export const dominionInjectedConnector = injected({ shimDisconnect: false });

// Connection state is intentionally memory-only. Automatic reconnect-on-mount
// would rerun during root provider renders and can clear a live SPA session
// when an injected provider briefly reports no authorized accounts.
export const wagmiReconnectOnMount = false;

export const wagmiConfig = createConfig({
  chains: [testnetBradbury],
  connectors: [dominionInjectedConnector],
  transports: {
    [testnetBradbury.id]: http(testnetBradbury.rpcUrls.default.http[0]),
  },
  multiInjectedProviderDiscovery: false,
  storage: null,
  ssr: false,
});
