# Dominion Markets

Build a COMPLETE frontend-first dApp named DOMINION in this single pass. Do not stop after scaffolding. Do not return a plan. Do not say what remains. Create all routes/pages, wire navigation/providers, fix build/runtime errors, and finish with a working rendered preview.

CREDIT EFFICIENCY IS CRITICAL:
- Use one coherent implementation pass.
- No Supabase, database, auth backend, analytics, or unrelated integrations.
- No unnecessary abstractions or overengineering.
- Use mock data + a thin contract adapter layer only.
- Do not spend time on speculative features.
- Reuse components across pages.
- Desktop-first, responsive enough for tablet/mobile.

PRODUCT
Dominion is a permissionless 1-hour stock dominance prediction market on GenLayer.
Every market has exactly 3 fixed assets based on category:
BIG TECH: AAPL, META, GOOGL
AI & GROWTH: NVDA, PLTR, TSLA
CRYPTO & FINTECH: MSTR, COIN, HOOD

Rules reflected in UI:
- exactly 1-hour clean UTC market windows
- users choose ONE asset per wallet per market
- same-asset top-ups allowed
- switching asset after first bet is not allowed
- minimum bet 1 GEN
- no app-level max
- 0% fee
- pari-mutuel pool model, NOT odds/order-book/AMM/yes-no shares
- settlement uses Binance + Bitget + Gate reference/index candles
- 2-of-3 source consensus
- highest numerical percentage return wins, including least-negative if all three are negative
- any wallet may create markets
- any wallet may settle expired markets
- only the position owner can claim/refund

VISUAL DIRECTION
Create an original premium dark financial interface inspired conceptually by:
- Polymarket: dense market discovery, compact cards, search/filter hierarchy, market detail with sticky action panel
- Crown: near-black GenLayer dashboard, clean portfolio stat cards, permissionless create flow, compact nav
- Manifold: simple browse hierarchy
Do NOT clone any brand.

Design system:
- near-black background #0b0d0f / #0f1114
- slightly lighter panels
- subtle borders, 12-16px radius, minimal shadows
- primary accent: electric violet/indigo
- sparing gold accent for protocol/premium cues
- green for positive/claimable, red only warnings/loss
- muted gray secondary text
- crisp financial typography and tabular numerals
- no glassmorphism overload, no gradients everywhere
- simple DOMINION logo using Lucide crown/shield/orbit icon + wordmark

TOP NAV — MUST BE COMPLETE AND WORKING
Desktop:
- DOMINION logo
- Markets
- Portfolio
- Activity
- Create Market
- How it works
- search input
- notification bell with badge
- GenLayer Bradbury Testnet status pill
- mock wallet pill with truncated address and GEN balance
Mobile: compact header + drawer or bottom navigation.

ROUTES — ALL MUST EXIST AND RENDER
1. / -> redirect/render /markets
2. /markets
3. /market/:id
4. /portfolio
5. /activity
6. /create
7. /how-it-works

Use whatever routing system the default Lovable stack uses. Every nav link must work. No placeholder route pages.

MOCK DATA LAYER
Create a small typed mock data source with at least 12 markets spanning:
- all 3 categories
- OPEN
- UPCOMING
- SETTLED
- INCONCLUSIVE
- some with connected wallet positions
- some claimable/refundable
Include a connected mock wallet with address and GEN balance.

Create a thin contractAdapter exposing future-compatible methods:
- getConfig
- getMarket
- getMarkets
- getOpenMarkets
- getUserPosition
- getUserPositions
- getClaimableMarkets
- getSourceEvidence
- getMarketByCategoryStart
- getUserActivityCount
- getUserActivity
- createMarket
- placeBet
- settleMarket
- claim
- claimRefund
For now these operate on mock data only.

MARKETS PAGE — COMPLETE
Hero/header: “Stock dominance, one hour at a time.” plus short subtitle.
Filters:
- All
- Big Tech
- AI & Growth
- Crypto & Fintech
Status filters:
- Open
- Upcoming
- Settled
- Inconclusive
Search by category, asset symbol, or market ID.
3-column desktop grid, 2 tablet, 1 mobile.
Each card shows:
- category badge
- exact UTC window
- countdown/status
- total pool GEN
- three asset rows with symbol, company name, pool GEN, pool share %
- visual pool-share bar
- connected-wallet selection indicator if positioned
- CTA View Market / Bet Now
Cards must feel dense and polished, not huge empty panels.

MARKET DETAIL PAGE — COMPLETE
Left/main section:
- category + market ID
- title like “Which stock leads BIG TECH from 15:00–16:00 UTC?”
- start/end/countdown/status
- total pool
- three large outcome cards/rows showing asset symbol, company, pool, pool share
- user position summary if present
- market rules section
- settlement explanation
- source evidence section for Binance / Bitget / Gate with status and winner for settled examples
- clear winner state after settlement
- inconclusive/refund presentation when applicable
Right sticky betting panel:
- three selectable asset buttons
- amount input in GEN
- quick buttons +1, +5, +10, MAX mock balance
- minimum 1 GEN copy
- estimated pool share / informational summary, NOT fake odds
- 0% fee
- Place Bet button
- if wallet already chose an asset, lock other two and allow top-up same asset only
- if market settled, replace with Claim Winnings / Claim Refund / result state
- mock actions update UI/toast

PORTFOLIO PAGE — COMPLETE
Top stat cards:
- Total Staked
- Claimable
- Active Positions
- Settled Positions
Tabs:
- Active
- Claimable
- History
Each position card/row shows market, category, selected asset, stake, state, result, claimable amount, CTA if claim/refund available.
Proper empty states included.

ACTIVITY PAGE — COMPLETE
Wallet activity timeline/list with compact cards for:
- BET_PLACED
- BET_TOPPED_UP
- PAYOUT_CLAIMED
- REFUND_CLAIMED
Also show derived states such as WON / LOST / REFUND AVAILABLE in presentation if useful.
Include filters All / Bets / Claims / Refunds.
Notification bell dropdown in nav should show latest activity, unread badge managed locally in mock state; no blockchain write concept.

CREATE MARKET PAGE — COMPLETE
Permissionless creation UI.
- category selector: Big Tech, AI & Growth, Crypto & Fintech
- show the 3 locked assets for selected category
- date picker
- only exact upcoming 1-hour UTC windows such as 15:00→16:00
- past windows disabled
- selected-window preview card
- concise protocol rules
- Create Market button
- mock creation success toast and route to created market
No arbitrary stock selection.

HOW IT WORKS PAGE — COMPLETE
Sections:
1. Choose a category
2. Pick one stock
3. Pari-mutuel pool
4. 1-hour reference-price window
5. 2-of-3 source settlement
6. Highest percentage return wins, including least-negative
7. Claims/refunds
8. Permissionless create and settlement
Include concise FAQ accordion.

FRONTEND READ UX
Expose frontend-ready fields in mock objects for:
- total pool
- per-asset pools
- betting open
- settlement available
- winner
- winning pool
- claimed pool
- remaining pool
- user selected asset
- user stake
- can top up
- position won/lost
- claim/refund availability
- claimable amount
- claim type

NOTIFICATION MODEL
Use local/mock activity records only. Bell badge should derive unread count from local state. Do not build backend notifications.

INTERACTION QUALITY
- All buttons and filters should work against mock state.
- Search should work.
- category/status filters should work.
- market cards navigate correctly.
- wallet position top-up restrictions should work in mock UI.
- claim/refund buttons update local mock state and toast success.
- create-market flow should work with mock data.
- no dead nav links.
- no blank screens.

TECHNICAL FINISH REQUIREMENT
Before finishing:
- create every route file
- wire root providers
- wire nav
- ensure app compiles
- fix TypeScript errors
- fix runtime errors
- ensure preview renders on /markets and every route
- do NOT stop to explain incomplete work
- if something breaks, fix it in this same pass

FINAL RESPONSE SHOULD ONLY SUMMARIZE WHAT WAS ACTUALLY COMPLETED AND CONFIRM THE PREVIEW RENDERS. Do not propose future work unless something is genuinely impossible.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/b2ae7c77-b518-4f54-b133-84d19b00cffa).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
