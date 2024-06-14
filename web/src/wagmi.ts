import { defaultWagmiConfig } from "@web3modal/wagmi";
import { mainnet, sepolia } from "wagmi/chains";
import { coinbaseWallet, injected } from "wagmi/connectors";

export const config = defaultWagmiConfig({
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID!,
  metadata: {
    name: "executooor",
    description: "Executooor UI",
    url: "https://rubilmax.github.io",
    icons: [],
  },
  chains: [mainnet, sepolia],
  connectors: [injected(), coinbaseWallet({ appName: "Executooor UI" })],
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
